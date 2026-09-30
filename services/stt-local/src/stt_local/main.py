"""Entry point: validate the configuration (exit 1 on errors), load the model in the background,
serve HTTP and WebSocket. Readiness stays red until the model is loaded."""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
from collections.abc import Callable
from typing import Any

import uvicorn

from stt_local.app import State, create_app
from stt_local.config import ConfigError, Settings, load_settings
from stt_local.transcriber import Transcriber

SERVICE = "stt-local"


class JsonFormatter(logging.Formatter):
    """One JSON object per line, like the Node services; extra fields are merged in."""

    _standard = frozenset(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "level": record.levelname.lower(),
            "time": round(record.created * 1000),
            "service": SERVICE,
            "msg": record.getMessage(),
        }
        line.update({k: v for k, v in record.__dict__.items() if k not in self._standard})
        if record.exc_info:
            line["err"] = self.formatException(record.exc_info)
        return json.dumps(line, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level.upper(), handlers=[handler], force=True)
    # One line per HTTP request of the model download is noise (and would log URLs).
    for noisy in ("httpx", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _whisper(settings: Settings) -> Transcriber:
    from stt_local.transcriber import WhisperTranscriber  # noqa: PLC0415 - keeps startup fast

    return WhisperTranscriber(settings)


def load_model(
    state: State,
    settings: Settings,
    factory: Callable[[Settings], Transcriber] = _whisper,
    exit_process: Callable[[int], object] = os._exit,
) -> None:
    """Loads the model in the background. A failure (no disk space, no network, unknown model)
    ends the process with exit code 1: the container restarts and its status shows the problem,
    instead of a service that stays not ready without saying why."""
    log = logging.getLogger("stt_local")
    try:
        state.transcriber = factory(settings)
        log.info(
            "model loaded", extra={"model": settings.model, "compute_type": settings.compute_type}
        )
    except Exception:
        log.exception("model could not be loaded, exiting", extra={"model": settings.model})
        logging.shutdown()
        exit_process(1)


def run() -> None:
    try:
        settings = load_settings()
    except ConfigError as error:
        configure_logging("info")
        logging.getLogger("stt_local").critical(
            "invalid configuration, exiting", extra={"issues": error.issues}
        )
        sys.exit(1)
    configure_logging(settings.log_level)
    state = State()
    threading.Thread(target=load_model, args=(state, settings), daemon=True).start()
    app = create_app(state, settings.silence_ms, settings.max_chunk_ms)
    logging.getLogger("stt_local").info(
        "service started", extra={"host": settings.host, "port": settings.port}
    )
    uvicorn.run(app, host=settings.host, port=settings.port, log_config=None, access_log=False)


if __name__ == "__main__":
    run()
