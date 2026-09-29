# faster-whisper for `stt-local` (research, 2026-09-29)

Sources: faster-whisper README and docs via Context7 (`/systran/faster-whisper`), faster-whisper issues #515 and #911 (Apple Silicon), a 2026 whisper.cpp vs faster-whisper comparison (links below). Figures are indicative; T3 measures on the owner's M2.

## Key facts

- faster-whisper is Whisper on **CTranslate2**. Devices: CUDA or CPU. **No Metal/MPS support**: on Apple Silicon it runs on the CPU only, natively as well as in Docker (`device="mps"` fails with `unsupported device`).
- Consequence for brief 10 ("natively on the Mac because it is faster"): natively it is faster only because it gets all CPU cores and memory without the 8 GB Docker VM, **not** because of the GPU. Rough order: large-v3 about 3× real time on Apple Silicon CPU; small/medium with `int8` well below real time.
- GPU on the Mac would need another engine: **whisper.cpp** (Metal, Core ML for the encoder) or **mlx-whisper**. That would be a deviation from the brief (faster-whisper) → owner decision, ADR 0016 lists it as an option for the native mode only.

## Settings for German

- Models: `small` (fast, weaker), `medium` (good German, slower), `large-v3-turbo` (large encoder, small decoder; best quality/speed ratio for CPU with `int8`). Start: `large-v3-turbo` natively, `small` or `medium` in the container; configurable via `LOCAL_STT_MODEL`.
- `compute_type="int8"` on CPU; `cpu_threads` = physical cores; `beam_size=1` for latency.
- `language="de"` fixed (no detection pass), `condition_on_previous_text=False` (avoids hallucinated repetition on short chunks).
- **VAD:** `vad_filter=True` uses Silero VAD; `vad_parameters={"min_silence_duration_ms": 500}`. For pseudo-streaming the service does its own chunking: collect PCM frames, cut at a VAD pause (or after at most ~15 s), transcribe the chunk, emit one final segment. Interim results: optional partial transcription of the growing chunk every ~1–2 s (costly on CPU; off by default).
- Memory: `large-v3-turbo` int8 roughly 1–2 GB RAM, `medium` int8 ~1 GB, `small` < 1 GB. Together with an LLM in LM Studio on 16 GB: tight, hence the native recommendation.

## Service shape (T3)

- FastAPI + `uvicorn`, WebSocket endpoint `/v1/stream` (same framing as our internal audio protocol: JSON start, binary PCM16 frames, JSON stop), `/healthz`, `/readyz` (model loaded).
- Model download at build time is not possible for every model size; the runtime image downloads on first start into a cache volume (`HF_HOME`), readiness stays red until the model is loaded. Offline start with a pre-filled volume must work.
- Python tooling: `uv` (lockfile), ruff, mypy strict, pytest; image based on a slim Python image, non-root, read-only root filesystem, writable cache volume and `/tmp`.

## Links

- https://github.com/SYSTRAN/faster-whisper
- https://github.com/SYSTRAN/faster-whisper/issues/911
- https://github.com/SYSTRAN/faster-whisper/issues/515
- https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026
