# syntax=docker/dockerfile:1.7
# Build context: repository root (like every service).
#   docker build -f services/stt-local/Dockerfile --target runtime .
# Stages: base -> deps -> dev (tests, ruff, mypy) | runtime (non-root, read-only code).
# The Whisper model is not baked in: it is downloaded on first start into the volume at HF_HOME.

FROM python:3.12.14-slim-trixie AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /usr/local/bin/uv
WORKDIR /app

FROM base AS deps
COPY services/stt-local/pyproject.toml services/stt-local/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Development and tests: dev dependencies, sources mounted or copied.
FROM deps AS dev
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project
COPY services/stt-local/ ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen
ENV PATH="/app/.venv/bin:${PATH}"
CMD ["stt-local"]

FROM deps AS build
COPY services/stt-local/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Runtime: no uv, no build tools; code root-owned and read-only for uid 65532.
FROM python:3.12.14-slim-trixie AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:${PATH}" \
    HF_HOME=/models \
    PORT=8000
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/src /app/src
# The model cache is the only writable path; a named volume inherits this owner on first use.
RUN mkdir /models && chown 65532:65532 /models
USER 65532:65532
EXPOSE 8000
CMD ["stt-local"]
