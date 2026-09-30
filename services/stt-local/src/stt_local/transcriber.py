"""The only place that touches faster-whisper (the system boundary; tests use a fake)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from stt_local.config import Settings


class Transcriber(Protocol):
    def transcribe(self, pcm: bytes, language: str) -> str: ...


def to_float32(pcm: bytes) -> NDArray[np.float32]:
    """PCM16 LE → float32 in [-1, 1), the input format of faster-whisper."""
    usable = len(pcm) - len(pcm) % 2
    return np.frombuffer(pcm[:usable], dtype="<i2").astype(np.float32) / 32768.0


class WhisperTranscriber:
    """faster-whisper on the CPU with int8 (no Metal on Apple Silicon, see
    `.ai/research/faster-whisper.md`).

    Loading downloads the model into the Hugging Face cache (`HF_HOME`) on first use.
    """

    def __init__(self, settings: Settings) -> None:
        # Heavy import, only when a model is actually loaded.
        from faster_whisper import WhisperModel  # noqa: PLC0415

        self._model = WhisperModel(
            settings.model,
            device="cpu",
            compute_type=settings.compute_type,
            cpu_threads=settings.cpu_threads,
        )

    def transcribe(self, pcm: bytes, language: str) -> str:
        segments, _info = self._model.transcribe(
            to_float32(pcm),
            language=language.split("-", maxsplit=1)[0],
            beam_size=1,
            vad_filter=True,
            # Short chunks: conditioning on earlier text makes Whisper repeat itself.
            condition_on_previous_text=False,
        )
        return " ".join(str(segment.text).strip() for segment in segments).strip()
