from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class RuntimeSettings(BaseModel):
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    telemetry_hz: float = Field(default=10.0, gt=0, le=60)
    config_dir: Path = PROJECT_ROOT / "config"


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
    return {
        "vehicle": load_yaml("vehicle.yaml"),
        "sensors": load_yaml("sensors.yaml"),
        "safety": load_yaml("safety.yaml"),
        "demo": load_yaml("demo.yaml"),
    }

