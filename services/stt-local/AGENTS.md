# AGENTS.md – services/stt-local

Rules for this service only. Repo-wide rules: `/AGENTS.md`. The only Python service (brief 5, 10; ADR 0016).

- Responsibility: local speech-to-text with faster-whisper for `STT_PROVIDER=local`. WebSocket `/v1/stream` with the protocol of the `local` adapter in `packages/providers/src/stt/local.ts` (start / PCM16 frames / stop → segment / error); change both sides together.
- Pseudo-streaming: `chunker.py` cuts the audio at pauses (RMS below 330 for `LOCAL_STT_SILENCE_MS`) or at `LOCAL_STT_MAX_CHUNK_MS`; each chunk becomes one final segment, speaker always `A` (no diarization yet).
- `transcriber.py` is the only module that imports faster-whisper; tests use a fake transcriber there (system boundary, brief 13.1). No test loads a model or touches the network.
- One transcription at a time per process (the CPU is the bottleneck); receiving continues while a chunk is transcribed (queue in `app.py`).
- Never log transcript text (brief 15.6); logs carry durations, byte counts and character counts only.
- Configuration only via environment variables, validated at startup in `config.py` (exit 1 with every problem listed). No secrets.
- Tooling (brief 13.1, stage 0/1): `uv` with a frozen `uv.lock`, direct dependencies pinned exactly in `pyproject.toml`; ruff, mypy strict, pytest. Run them in the `dev` image, never on the host:
  `docker build --target dev -t lfc/stt-local:dev -f services/stt-local/Dockerfile . && docker run --rm lfc/stt-local:dev sh -c 'ruff check . && ruff format --check . && mypy && pytest'`
- Faster-whisper has no Metal support: natively on the Mac it also runs on the CPU (`.ai/research/faster-whisper.md`). Agents never install Python on the host; the native start is documented for the owner in `README.md`.
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532, code read-only, only `/models` (the Hugging Face cache volume) and `/tmp` writable.
