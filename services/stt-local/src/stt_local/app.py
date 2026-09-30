"""HTTP and WebSocket interface (protocol shared with the `local` adapter in packages/providers).

client → {"type":"start","sampleRate":16000,"language":"de"}, binary PCM16 frames, {"type":"stop"}
server → {"type":"segment","text","isFinal","startMs","endMs"} … ; {"type":"error","message"}
After `stop` the server transcribes the rest, sends the last segments and closes normally.
Transcript text is never logged (brief 15.6).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Annotated, Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from stt_local.chunker import Chunk, Chunker
from stt_local.transcriber import Transcriber

log = logging.getLogger("stt_local")

MAX_FRAME_BYTES = 8 * 1024
# Audio queued for or in transcription. Whisper on a slow CPU falls behind the speaker; beyond
# this the stream ends with "overloaded" instead of holding ever more audio in memory. The
# caller's socket buffer limit (STT_MAX_BUFFERED_BYTES) cannot see this queue.
MAX_BACKLOG_MS = 60_000
# WebSocket close codes: policy violation, try again later.
CLOSE_POLICY = 1008
CLOSE_NOT_READY = 1013


class StartMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["start"]
    sampleRate: Literal[16000]  # noqa: N815 - wire format
    language: Annotated[str, Field(pattern=r"^[a-z]{2,3}(-[A-Z]{2})?$")]


class StopMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["stop"]


@dataclass
class State:
    """Filled when the model is loaded; `/readyz` answers 503 until then."""

    transcriber: Transcriber | None = None
    # One transcription at a time per process: Whisper on the CPU already uses every core.
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def create_app(
    state: State, silence_ms: int, max_chunk_ms: int, max_backlog_ms: int = MAX_BACKLOG_MS
) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> JSONResponse:
        if state.transcriber is None:
            return JSONResponse({"status": "not_ready", "checks": {"model": "loading"}}, 503)
        return JSONResponse({"status": "ready", "checks": {"model": "ok"}})

    @app.websocket("/v1/stream")
    async def stream(socket: WebSocket) -> None:
        await socket.accept()
        await _stream(socket, state, Chunker(silence_ms, max_chunk_ms), max_backlog_ms)

    return app


async def _send_error(socket: WebSocket, message: str, code: int) -> None:
    await socket.send_json({"type": "error", "message": message})
    await socket.close(code)


async def _stream(socket: WebSocket, state: State, chunker: Chunker, max_backlog_ms: int) -> None:
    transcriber = state.transcriber
    if transcriber is None:
        await _send_error(socket, "model not loaded", CLOSE_NOT_READY)
        return
    try:
        start = StartMessage.model_validate_json(await socket.receive_text())
    except (ValidationError, WebSocketDisconnect, KeyError, RuntimeError):
        await _send_error(socket, "first message must be start", CLOSE_POLICY)
        return

    queue = _ChunkQueue(max_backlog_ms)
    worker = asyncio.create_task(_transcribe_chunks(socket, state, transcriber, start, queue))
    pipe = _Pipeline(chunker, queue, worker)
    try:
        while True:
            message = await socket.receive()
            if message["type"] == "websocket.disconnect":
                worker.cancel()
                return
            data = message.get("bytes")
            if data is None:
                await _finish(socket, message.get("text"), pipe)
                return
            if not await _accept_frame(socket, data, pipe):
                worker.cancel()
                return
    except WebSocketDisconnect:
        worker.cancel()


@dataclass
class _ChunkQueue:
    """Chunks waiting for the worker; `backlog_ms` counts their audio until it is transcribed."""

    limit_ms: int
    chunks: asyncio.Queue[Chunk | None] = field(default_factory=asyncio.Queue)
    backlog_ms: int = 0

    async def put(self, chunk: Chunk) -> bool:
        """Queues a chunk; False when the backlog would exceed its limit."""
        duration = chunk.end_ms - chunk.start_ms
        if self.backlog_ms + duration > self.limit_ms:
            return False
        self.backlog_ms += duration
        await self.chunks.put(chunk)
        return True

    def done(self, chunk: Chunk) -> None:
        self.backlog_ms -= chunk.end_ms - chunk.start_ms


@dataclass
class _Pipeline:
    """One stream's way from frames to the transcription worker, with counters for the log."""

    chunker: Chunker
    queue: _ChunkQueue
    worker: asyncio.Task[None]
    audio_bytes: int = 0
    chunk_count: int = 0

    async def put(self, chunk: Chunk) -> bool:
        """Queues a chunk; False when transcription has fallen too far behind."""
        if not await self.queue.put(chunk):
            return False
        self.chunk_count += 1
        return True


async def _accept_frame(socket: WebSocket, data: bytes, pipe: _Pipeline) -> bool:
    """Queues the chunks a frame completes; False (socket closed) when it cannot."""
    if len(data) > MAX_FRAME_BYTES:
        await _send_error(socket, "frame too large", CLOSE_POLICY)
        return False
    pipe.audio_bytes += len(data)
    for chunk in pipe.chunker.feed(data):
        if not await pipe.put(chunk):
            log.warning(
                "transcription fell behind, stream ended",
                extra={"backlog_ms": pipe.queue.backlog_ms},
            )
            await _send_error(socket, "overloaded", CLOSE_NOT_READY)
            return False
    return True


async def _finish(socket: WebSocket, text: str | None, pipe: _Pipeline) -> None:
    """Handles the only text message after start: stop flushes, waits for the worker, closes."""
    try:
        StopMessage.model_validate(json.loads(text or ""))
    except (ValidationError, ValueError):
        pipe.worker.cancel()
        await _send_error(socket, "invalid message", CLOSE_POLICY)
        return
    rest = pipe.chunker.flush()
    if rest is not None and not await pipe.put(rest):
        log.warning(
            "transcription fell behind, last chunk dropped",
            extra={"backlog_ms": pipe.queue.backlog_ms},
        )
    await pipe.queue.chunks.put(None)
    await pipe.worker
    log.info("stream finished", extra={"audio_bytes": pipe.audio_bytes, "chunks": pipe.chunk_count})
    await socket.close(1000)


async def _transcribe_chunks(
    socket: WebSocket,
    state: State,
    transcriber: Transcriber,
    start: StartMessage,
    queue: _ChunkQueue,
) -> None:
    while (chunk := await queue.chunks.get()) is not None:
        started = time.monotonic()
        async with state.lock:
            text = await asyncio.to_thread(transcriber.transcribe, chunk.pcm, start.language)
        queue.done(chunk)
        log.info(
            "chunk transcribed",
            extra={
                "audio_ms": chunk.end_ms - chunk.start_ms,
                "took_ms": round((time.monotonic() - started) * 1000),
                "characters": len(text),
            },
        )
        if text:
            await socket.send_json(
                {
                    "type": "segment",
                    "text": text[:10_000],
                    "isFinal": True,
                    "startMs": chunk.start_ms,
                    "endMs": chunk.end_ms,
                }
            )
