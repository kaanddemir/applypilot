"""Environment-backed settings for the local ApplyPilot server."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class Settings:
    # repr=False keeps accidental settings logging from exposing the credential.
    gemini_api_key: str
    gemini_model: str
    gemini_connect_timeout_seconds: float
    gemini_timeout_seconds: float
    analysis_client_limit_per_minute: int
    analysis_global_limit_per_minute: int
    analysis_max_concurrency: int
    analysis_max_body_bytes: int
    cors_origins: tuple[str, ...]
    allowed_hosts: tuple[str, ...]
    gemini_max_output_tokens: int = 16_384
    gemini_thinking_level: str = "low"

    def __repr__(self) -> str:
        return (
            "Settings(gemini_api_key=<redacted>, "
            f"gemini_model={self.gemini_model!r}, "
            f"gemini_timeout_seconds={self.gemini_timeout_seconds!r})"
        )


def load_settings() -> Settings:
    origins = tuple(
        value.strip()
        for value in os.getenv("APPLYPILOT_CORS_ORIGINS", "").split(",")
        if value.strip()
    )
    allowed_hosts = tuple(
        value.strip()
        for value in os.getenv("APPLYPILOT_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
        if value.strip()
    )
    model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip() or "gemini-3.8-flash"
    # Explicitly tested configuration; do not silently apply incompatible thinking
    # parameters to arbitrary models supplied through the environment.
    if model != "gemini-3.8-flash":
        raise RuntimeError("GEMINI_MODEL must be gemini-3.8-flash for this analysis configuration")
    thinking = os.getenv("GEMINI_THINKING_LEVEL", "low").strip()
    if thinking not in {"low", "medium", "high"}:
        raise RuntimeError("GEMINI_THINKING_LEVEL must be low, medium, or high")
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=model,
        gemini_connect_timeout_seconds=_float("GEMINI_CONNECT_TIMEOUT_SECONDS", 5.0, 0.1, 30.0),
        gemini_timeout_seconds=_float("GEMINI_TIMEOUT_SECONDS", 90.0, 1.0, 90.0),
        analysis_client_limit_per_minute=_int("ANALYSIS_CLIENT_LIMIT_PER_MINUTE", 6, 1, 1000),
        analysis_global_limit_per_minute=_int("ANALYSIS_GLOBAL_LIMIT_PER_MINUTE", 20, 1, 10000),
        analysis_max_concurrency=_int("ANALYSIS_MAX_CONCURRENCY", 2, 1, 100),
        analysis_max_body_bytes=_int("ANALYSIS_MAX_BODY_BYTES", 80 * 1024, 1024, 1024 * 1024),
        cors_origins=origins,
        allowed_hosts=allowed_hosts,
        gemini_max_output_tokens=_int("GEMINI_MAX_OUTPUT_TOKENS", 16_384, 4_096, 32_768),
        gemini_thinking_level=thinking,
    )


settings = load_settings()
