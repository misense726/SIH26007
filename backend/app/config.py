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
    sensor_settings_path: Path = PROJECT_ROOT / "runtime" / "sensor_display.json"
    runtime_mode: Literal["SIMULATED", "LIVE"] = "SIMULATED"
    telemetry_transport: Literal["SERIAL", "WIFI", "BOTH"] = "SERIAL"
    serial_port: str | None = None
    serial_baud: int = Field(default=115200, ge=1200, le=3_000_000)
    serial_stale_ms: int = Field(default=750, ge=50, le=60_000)
    serial_poll_interval_ms: int = Field(default=10, ge=1, le=1_000)
    serial_reconnect_ms: int = Field(default=1_000, ge=50, le=60_000)
    wifi_listen_host: str = "0.0.0.0"
    wifi_listen_port: int = Field(default=8765, ge=1, le=65535)
    camera_stream_url: str | None = None
    camera_stale_ms: int = Field(default=1_500, ge=250, le=60_000)
    camera_reconnect_ms: int = Field(default=1_000, ge=100, le=60_000)
    camera_open_timeout_ms: int = Field(default=15_000, ge=1_000, le=60_000)
    camera_read_timeout_ms: int = Field(default=5_000, ge=1_000, le=60_000)
    camera_jpeg_quality: int = Field(default=88, ge=40, le=100)
    camera_metrics_interval_ms: int = Field(default=500, ge=100, le=10_000)
    camera_dehaze_enabled: bool = False
    camera_dehaze_model_root: Path = Path("/opt/fogsen-model")
    camera_dehaze_device: Literal["auto", "cuda", "cpu"] = "auto"
    camera_dehaze_fp16: bool = True
    camera_dehaze_max_fps: float = Field(default=30.0, gt=0.0, le=30.0)
    camera_ir_enabled: bool = False
    camera_ir_device: Literal["auto", "cuda", "cpu"] = "auto"
    camera_ir_fp16: bool = True
    camera_ir_max_fps: float = Field(default=30.0, gt=0.0, le=60.0)
    camera_ir_colormap: str = "INFERNO"

    @model_validator(mode="after")
    def require_live_serial_port(self) -> "RuntimeSettings":
        if (
            self.runtime_mode == "LIVE"
            and self.telemetry_transport in {"SERIAL", "BOTH"}
            and not (self.serial_port or "").strip()
        ):
            raise ValueError("FOGSEN_SERIAL_PORT is required when FOGSEN_MODE=LIVE")
        return self


def _configured_path(raw_path: str | Path) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def _environment_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


@lru_cache(maxsize=1)
def runtime_settings() -> RuntimeSettings:
    return RuntimeSettings(
        host=os.getenv("FOGSEN_HOST", "127.0.0.1"),
        port=int(os.getenv("FOGSEN_PORT", "8000")),
        telemetry_hz=float(os.getenv("FOGSEN_TELEMETRY_HZ", "10")),
        config_dir=_configured_path(os.getenv("FOGSEN_CONFIG_DIR", "config")),
        sensor_settings_path=_configured_path(
            os.getenv(
                "FOGSEN_SENSOR_SETTINGS_PATH",
                "runtime/sensor_display.json",
            )
        ),
        runtime_mode=os.getenv("FOGSEN_MODE", "SIMULATED").strip().upper(),
        telemetry_transport=os.getenv("FOGSEN_TELEMETRY_TRANSPORT", "SERIAL")
        .strip()
        .upper(),
        serial_port=os.getenv("FOGSEN_SERIAL_PORT"),
        serial_baud=int(os.getenv("FOGSEN_SERIAL_BAUD", "115200")),
        serial_stale_ms=int(os.getenv("FOGSEN_SERIAL_STALE_MS", "750")),
        serial_poll_interval_ms=int(os.getenv("FOGSEN_SERIAL_POLL_MS", "10")),
        serial_reconnect_ms=int(os.getenv("FOGSEN_SERIAL_RECONNECT_MS", "1000")),
        wifi_listen_host=os.getenv("FOGSEN_WIFI_LISTEN_HOST", "0.0.0.0"),
        wifi_listen_port=int(os.getenv("FOGSEN_WIFI_LISTEN_PORT", "8765")),
        camera_stream_url=(os.getenv("FOGSEN_CAMERA_STREAM_URL") or "").strip() or None,
        camera_stale_ms=int(os.getenv("FOGSEN_CAMERA_STALE_MS", "1500")),
        camera_reconnect_ms=int(os.getenv("FOGSEN_CAMERA_RECONNECT_MS", "1000")),
        camera_open_timeout_ms=int(
            os.getenv("FOGSEN_CAMERA_OPEN_TIMEOUT_MS", "15000")
        ),
        camera_read_timeout_ms=int(
            os.getenv("FOGSEN_CAMERA_READ_TIMEOUT_MS", "5000")
        ),
        camera_jpeg_quality=int(os.getenv("FOGSEN_CAMERA_JPEG_QUALITY", "88")),
        camera_metrics_interval_ms=int(
            os.getenv("FOGSEN_CAMERA_METRICS_INTERVAL_MS", "500")
        ),
        camera_dehaze_enabled=_environment_bool("FOGSEN_CAMERA_DEHAZE_ENABLED", False),
        camera_dehaze_model_root=Path(
            os.getenv("FOGSEN_CAMERA_DEHAZE_MODEL_ROOT", "/opt/fogsen-model")
        ),
        camera_dehaze_device=os.getenv("FOGSEN_CAMERA_DEHAZE_DEVICE", "auto")
        .strip()
        .lower(),
        camera_dehaze_fp16=_environment_bool("FOGSEN_CAMERA_DEHAZE_FP16", True),
        camera_dehaze_max_fps=float(
            os.getenv("FOGSEN_CAMERA_DEHAZE_MAX_FPS", "30")
        ),
        camera_ir_enabled=_environment_bool("FOGSEN_CAMERA_IR_ENABLED", False),
        camera_ir_device=os.getenv("FOGSEN_CAMERA_IR_DEVICE", "auto")
        .strip()
        .lower(),
        camera_ir_fp16=_environment_bool("FOGSEN_CAMERA_IR_FP16", True),
        camera_ir_max_fps=float(
            os.getenv("FOGSEN_CAMERA_IR_MAX_FPS", "30")
        ),
        camera_ir_colormap=os.getenv("FOGSEN_CAMERA_IR_COLORMAP", "INFERNO")
        .strip()
        .upper(),
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
