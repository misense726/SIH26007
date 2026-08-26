from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class RuntimeSettings(BaseModel):
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    telemetry_hz: float = Field(default=10.0, gt=0, le=60)
    config_dir: Path = PROJECT_ROOT / "config"
    runtime_mode: Literal["SIMULATED", "LIVE"] = "SIMULATED"
    serial_port: str | None = None
    serial_baud: int = Field(default=115200, ge=1200, le=3_000_000)
    serial_stale_ms: int = Field(default=750, ge=50, le=60_000)
    serial_poll_interval_ms: int = Field(default=10, ge=1, le=1_000)
    serial_reconnect_ms: int = Field(default=1_000, ge=50, le=60_000)

    @model_validator(mode="after")
    def require_live_serial_port(self) -> "RuntimeSettings":
        if self.runtime_mode == "LIVE" and not (self.serial_port or "").strip():
            raise ValueError("FOGSEN_SERIAL_PORT is required when FOGSEN_MODE=LIVE")
        return self


def _configured_path(raw_path: str | Path) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


@lru_cache(maxsize=1)
def runtime_settings() -> RuntimeSettings:
    return RuntimeSettings(
        host=os.getenv("FOGSEN_HOST", "127.0.0.1"),
        port=int(os.getenv("FOGSEN_PORT", "8000")),
        telemetry_hz=float(os.getenv("FOGSEN_TELEMETRY_HZ", "10")),
        config_dir=_configured_path(os.getenv("FOGSEN_CONFIG_DIR", "config")),
        runtime_mode=os.getenv("FOGSEN_MODE", "SIMULATED").strip().upper(),
        serial_port=os.getenv("FOGSEN_SERIAL_PORT"),
        serial_baud=int(os.getenv("FOGSEN_SERIAL_BAUD", "115200")),
        serial_stale_ms=int(os.getenv("FOGSEN_SERIAL_STALE_MS", "750")),
        serial_poll_interval_ms=int(os.getenv("FOGSEN_SERIAL_POLL_MS", "10")),
        serial_reconnect_ms=int(os.getenv("FOGSEN_SERIAL_RECONNECT_MS", "1000")),
    )


def load_yaml(name: str, settings: RuntimeSettings | None = None) -> dict[str, Any]:
    active_settings = settings or runtime_settings()
    path = active_settings.config_dir / name
    if not path.is_file():
        raise FileNotFoundError(f"FogSen configuration file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"FogSen configuration must contain a mapping: {path}")
    return data


@lru_cache(maxsize=1)
def project_config() -> dict[str, Any]:
    return load_project_config()


def load_project_config(
    settings: RuntimeSettings | None = None,
) -> dict[str, Any]:
    return {
        "vehicle": load_yaml("vehicle.yaml", settings),
        "sensors": load_yaml("sensors.yaml", settings),
        "safety": load_yaml("safety.yaml", settings),
        "demo": load_yaml("demo.yaml", settings),
    }
