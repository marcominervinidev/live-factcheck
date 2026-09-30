import logging

import pytest

from stt_local.app import State
from stt_local.config import Settings, load_settings
from stt_local.main import JsonFormatter, load_model

SETTINGS: Settings = load_settings({})


class Fake:
    def transcribe(self, pcm: bytes, language: str) -> str:
        return ""


def test_loads_the_model_into_the_state() -> None:
    state = State()
    exits: list[int] = []
    load_model(state, SETTINGS, factory=lambda _s: Fake(), exit_process=exits.append)
    assert isinstance(state.transcriber, Fake)
    assert exits == []


def test_exits_with_1_when_the_model_cannot_be_loaded(caplog: pytest.LogCaptureFixture) -> None:
    def broken(_settings: Settings) -> Fake:
        raise OSError("No space left on device")

    state = State()
    exits: list[int] = []
    with caplog.at_level(logging.ERROR, logger="stt_local"):
        load_model(state, SETTINGS, factory=broken, exit_process=exits.append)
    assert state.transcriber is None
    assert exits == [1]
    assert "model could not be loaded, exiting" in caplog.text


def test_formats_json_lines_with_extra_fields() -> None:
    record = logging.makeLogRecord(
        {"levelname": "INFO", "msg": "chunk transcribed", "audio_ms": 700}
    )
    line = JsonFormatter().format(record)
    assert '"service": "stt-local"' in line
    assert '"audio_ms": 700' in line
    assert '"msg": "chunk transcribed"' in line
