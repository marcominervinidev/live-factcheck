"""Cuts a PCM16 stream into speech chunks at pauses (VAD by energy), for pseudo-streaming.

Whisper transcribes whole chunks, not a live stream (brief 10). A chunk ends after
`silence_ms` of quiet audio following speech, or at `max_chunk_ms` at the latest; leading
silence is dropped. The same RMS threshold as the Deepgram adapter's silence detection.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass

SAMPLE_RATE = 16_000
BYTES_PER_SAMPLE = 2
SILENCE_RMS = 330.0


def rms(frame: bytes) -> float:
    """Root mean square of PCM16 LE samples; 0 for an empty frame."""
    count = len(frame) // BYTES_PER_SAMPLE
    if count == 0:
        return 0.0
    samples = struct.unpack(f"<{count}h", frame[: count * BYTES_PER_SAMPLE])
    return math.sqrt(sum(s * s for s in samples) / count)


def ms_of(byte_count: int) -> int:
    return round(byte_count / (SAMPLE_RATE * BYTES_PER_SAMPLE) * 1000)


@dataclass(frozen=True)
class Chunk:
    pcm: bytes
    start_ms: int
    end_ms: int


class Chunker:
    def __init__(self, silence_ms: int, max_chunk_ms: int) -> None:
        self._silence_ms = silence_ms
        self._max_chunk_ms = max_chunk_ms
        self._buffer = bytearray()
        self._position = 0  # bytes of audio seen so far
        self._chunk_start = 0  # byte offset of the buffer's first byte
        self._speech = False
        self._silent_ms = 0

    def feed(self, frame: bytes) -> list[Chunk]:
        """Adds one frame; returns the chunks that are complete now (usually none or one)."""
        chunks: list[Chunk] = []
        quiet = rms(frame) < SILENCE_RMS
        if not self._speech and quiet:
            # Leading silence is not transcribed.
            self._position += len(frame)
            self._chunk_start = self._position
            return chunks
        self._buffer.extend(frame)
        self._position += len(frame)
        if quiet:
            self._silent_ms += ms_of(len(frame))
        else:
            self._speech = True
            self._silent_ms = 0
        if self._silent_ms >= self._silence_ms or ms_of(len(self._buffer)) >= self._max_chunk_ms:
            chunk = self._take()
            if chunk is not None:
                chunks.append(chunk)
        return chunks

    def flush(self) -> Chunk | None:
        """The rest at the end of the stream, if it contains speech."""
        return self._take()

    def _take(self) -> Chunk | None:
        chunk = None
        if self._speech and self._buffer:
            chunk = Chunk(
                pcm=bytes(self._buffer),
                start_ms=ms_of(self._chunk_start),
                end_ms=ms_of(self._position),
            )
        self._buffer.clear()
        self._chunk_start = self._position
        self._speech = False
        self._silent_ms = 0
        return chunk
