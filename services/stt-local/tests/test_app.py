import json
import logging
import struct
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from stt_local.app import State, create_app
from stt_local.transcriber import to_float32

FRAME_SAMPLES = 1600
SPEECH = struct.pack(
    f"<{FRAME_SAMPLES}h", *[8000 if i % 2 else -8000 for i in range(FRAME_SAMPLES)]
)
QUIET = bytes(FRAME_SAMPLES * 2)
START = {"type": "start", "sampleRate": 16000, "language": "de"}


class FakeTranscriber:
    """Stands in for Whisper at the system boundary: answers by the chunk length."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, str]] = []

    def transcribe(self, pcm: bytes, language: str) -> str:
        self.calls.append((len(pcm), language))
        return f"Satz {len(self.calls)} mit {len(pcm) // 3200} Frames."


def client(transcriber: FakeTranscriber | None) -> TestClient:
    return TestClient(
        create_app(State(transcriber=transcriber), silence_ms=500, max_chunk_ms=15000)
    )


def test_health_and_readiness_follow_the_model() -> None:
    assert client(None).get("/healthz").json() == {"status": "ok"}
    not_ready = client(None).get("/readyz")
    assert not_ready.status_code == 503
    assert client(FakeTranscriber()).get("/readyz").json() == {
        "status": "ready",
        "checks": {"model": "ok"},
    }


def test_streams_chunks_as_final_segments_and_flushes_on_stop(
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake = FakeTranscriber()
    caplog.set_level(logging.INFO, logger="stt_local")
    with client(fake).websocket_connect("/v1/stream") as ws:
        ws.send_text(json.dumps(START))
        for frame in [QUIET] * 2 + [SPEECH] * 8 + [QUIET] * 5 + [SPEECH] * 3:
            ws.send_bytes(frame)
        first = ws.receive_json()
        ws.send_text(json.dumps({"type": "stop"}))
        second = ws.receive_json()
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 1000
    assert first == {
        "type": "segment",
        "text": "Satz 1 mit 13 Frames.",
        "isFinal": True,
        "startMs": 200,
        "endMs": 1500,
    }
    assert second == {
        "type": "segment",
        "text": "Satz 2 mit 3 Frames.",
        "isFinal": True,
        "startMs": 1500,
        "endMs": 1800,
    }
    assert fake.calls == [(13 * 3200, "de"), (3 * 3200, "de")]
    # Only sizes and durations in the logs, never the text (brief 15.6).
    assert "Satz" not in caplog.text
    assert any(getattr(r, "audio_bytes", None) == 18 * 3200 for r in caplog.records)


@pytest.mark.parametrize(
    ("first", "expected"),
    [
        ({"type": "stop"}, "first message must be start"),
        ({**START, "sampleRate": 48000}, "first message must be start"),
        ({**START, "language": "deutsch"}, "first message must be start"),
        ({**START, "token": "x"}, "first message must be start"),
    ],
)
def test_rejects_an_invalid_start(first: dict[str, object], expected: str) -> None:
    with client(FakeTranscriber()).websocket_connect("/v1/stream") as ws:
        ws.send_text(json.dumps(first))
        assert ws.receive_json() == {"type": "error", "message": expected}
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 1008


def test_rejects_oversized_frames_and_unknown_messages() -> None:
    with client(FakeTranscriber()).websocket_connect("/v1/stream") as ws:
        ws.send_text(json.dumps(START))
        ws.send_bytes(bytes(8 * 1024 + 2))
        assert ws.receive_json() == {"type": "error", "message": "frame too large"}
    with client(FakeTranscriber()).websocket_connect("/v1/stream") as ws:
        ws.send_text(json.dumps(START))
        ws.send_text('{"type":"rename"}')
        assert ws.receive_json() == {"type": "error", "message": "invalid message"}


class SlowTranscriber(FakeTranscriber):
    """Whisper on a slow CPU: blocks until the test releases it."""

    def __init__(self) -> None:
        super().__init__()
        self.release = threading.Event()

    def transcribe(self, pcm: bytes, language: str) -> str:
        self.release.wait(timeout=5)
        return super().transcribe(pcm, language)


def test_ends_the_stream_instead_of_piling_up_audio_when_transcription_falls_behind() -> None:
    slow = SlowTranscriber()
    app = create_app(
        State(transcriber=slow), silence_ms=500, max_chunk_ms=15000, max_backlog_ms=2000
    )
    try:
        with TestClient(app).websocket_connect("/v1/stream") as ws:
            ws.send_text(json.dumps(START))
            # Two utterances of 1.3 s each: together more than the 2 s the backlog may hold.
            for frame in ([SPEECH] * 8 + [QUIET] * 5) * 2:
                ws.send_bytes(frame)
            assert ws.receive_json() == {"type": "error", "message": "overloaded"}
            slow.release.set()
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
        assert closed.value.code == 1013
    finally:
        slow.release.set()


def test_refuses_streams_until_the_model_is_loaded() -> None:
    with client(None).websocket_connect("/v1/stream") as ws:
        assert ws.receive_json() == {"type": "error", "message": "model not loaded"}
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 1013


def test_converts_pcm16_to_float32() -> None:
    audio = to_float32(struct.pack("<3h", 0, 16384, -32768) + b"\x01")
    assert audio.dtype == np.float32
    assert audio.tolist() == [0.0, 0.5, -1.0]
