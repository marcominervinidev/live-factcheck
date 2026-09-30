"""Configuration from environment variables, validated at startup (brief 4.1 factor III)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

COMPUTE_TYPES = ("int8", "int8_float32", "float32")
LOG_LEVELS = ("debug", "info", "warning", "error")


class ConfigError(Exception):
    """Invalid configuration; lists every problem at once, never the values of secrets."""

    def __init__(self, issues: list[str]) -> None:
        super().__init__("; ".join(issues))
        self.issues = issues


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    model: str
    compute_type: str
    cpu_threads: int
    silence_ms: int
    max_chunk_ms: int
    log_level: str


class _Reader:
    """Reads variables and collects every problem instead of stopping at the first."""

    def __init__(self, env: Mapping[str, str]) -> None:
        self.env = env
        self.issues: list[str] = []

    def integer(self, key: str, default: int, bounds: tuple[int, int]) -> int:
        raw = self.env.get(key, "")
        if raw == "":
            return default
        try:
            value = int(raw)
        except ValueError:
            self.issues.append(f"{key}: must be an integer")
            return default
        low, high = bounds
        if not low <= value <= high:
            self.issues.append(f"{key}: must be between {low} and {high}")
        return value

    def choice(self, key: str, default: str, allowed: tuple[str, ...]) -> str:
        value = self.env.get(key, "") or default
        if value not in allowed:
            self.issues.append(f"{key}: must be one of {', '.join(allowed)}")
        return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Reads the settings; raises `ConfigError` naming every invalid variable (fail fast)."""
    read = _Reader(os.environ if env is None else env)
    model = read.env.get("LOCAL_STT_MODEL", "") or "small"
    if not all(c.isalnum() or c in "-._/" for c in model):
        read.issues.append("LOCAL_STT_MODEL: only letters, digits and - . _ / are allowed")
    # Loopback unless the container says otherwise (the image sets HOST=0.0.0.0).
    host = read.env.get("HOST", "") or "127.0.0.1"
    if not all(c.isalnum() or c in ".:" for c in host):
        read.issues.append("HOST: only an IP address or host name is allowed")
    settings = Settings(
        host=host,
        port=read.integer("PORT", 8000, (1, 65535)),
        model=model,
        compute_type=read.choice("LOCAL_STT_COMPUTE_TYPE", "int8", COMPUTE_TYPES),
        # 0 lets CTranslate2 use every core.
        cpu_threads=read.integer("LOCAL_STT_CPU_THREADS", 0, (0, 64)),
        silence_ms=read.integer("LOCAL_STT_SILENCE_MS", 500, (200, 3000)),
        max_chunk_ms=read.integer("LOCAL_STT_MAX_CHUNK_MS", 15000, (2000, 30000)),
        log_level=read.choice("LOG_LEVEL", "info", LOG_LEVELS),
    )
    if read.issues:
        raise ConfigError(read.issues)
    return settings
