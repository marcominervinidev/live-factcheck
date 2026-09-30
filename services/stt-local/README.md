# stt-local

Local speech-to-text for live-factcheck (brief 10, ADR 0016): faster-whisper on the CPU, audio cut into chunks at pauses. Nothing leaves your network, apart from the one-time model download from Hugging Face.

## In the Compose stack

```sh
make up-local                         # model "small" (first start downloads ~500 MB into a volume)
LOCAL_STT_MODEL=medium make up-local  # better German, slower
```

`make up-local` sets `STT_PROVIDER=local` and `LOCAL_STT_URL=ws://stt-local:8000/v1/stream` for `transcription`. The container runs on the CPU of the Docker VM.

## Natively on the Mac (optional, faster)

faster-whisper cannot use the GPU (Metal) on Apple Silicon; natively it is still faster than in the container because it gets all CPU cores and memory. You need [uv](https://docs.astral.sh/uv/) once:

```sh
brew install uv                                   # or: curl -LsSf https://astral.sh/uv/install.sh | sh
cd services/stt-local
LOCAL_STT_MODEL=large-v3-turbo uv run stt-local   # creates .venv in this folder, listens on :8000
```

Then point the stack at it and start it without the container:

```sh
STT_PROVIDER=local STT_MODEL=large-v3-turbo \
LOCAL_STT_URL=ws://host.docker.internal:8000/v1/stream make up
```

The model lands in `~/.cache/huggingface`. `large-v3-turbo` needs about 2 GB of RAM; with an LLM in LM Studio on a 16 GB Mac, `small` or `medium` is the safer choice.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `LOCAL_STT_MODEL` | `small` | `small`, `medium`, `large-v3-turbo`, … (Systran faster-whisper models) |
| `LOCAL_STT_COMPUTE_TYPE` | `int8` | `int8`, `int8_float32`, `float32` |
| `LOCAL_STT_CPU_THREADS` | `0` | 0 = all cores |
| `LOCAL_STT_SILENCE_MS` | `500` | pause that ends a chunk |
| `LOCAL_STT_MAX_CHUNK_MS` | `15000` | a chunk ends at the latest after this |
| `HOST` | `127.0.0.1` | bind address; the image sets `0.0.0.0` so other containers reach it |
| `PORT` | `8000` | |

## Measured (2026-09-29, `small`, int8, container on an M2 with 8 GB Docker VM)

`make stt-probe` with `STT_PROVIDER=local`: the 19 s test conversation came back as three correct segments ("der Zweite Weltkrieg endete im Jahr 1965", "3,9 Millionen", "1975"), 1.7–2.2 s after each pause; Whisper ran at about 3.4× real time.
