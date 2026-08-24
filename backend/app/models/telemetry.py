from __future__ import annotations

import time
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def now_ms() -> int:
    return time.time_ns() // 1_000_000


class DataMode(StrEnum):
    LIVE = "LIVE"
    SIMULATED = "SIMULATED"
    REPLAY = "REPLAY"


class VisibilityState(StrEnum):
    GOOD = "GOOD"
    MODERATE = "MODERATE"
    LOW = "LOW"
    VERY_LOW = "VERY_LOW"


class EmergencyLevel(StrEnum):
    SAFE = "SAFE"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    EMERGENCY_STOP = "EMERGENCY_STOP"


class SensorStatus(StrEnum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    STALE = "STALE"
    OFFLINE = "OFFLINE"


class TelemetryModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VehiclePose(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    vehicle_id: str = "DUMPER_01"
    x_m: float = 0.0
    y_m: float = 0.0
    heading_deg: float = Field(default=0.0, ge=0.0, lt=360.0)
    speed_mps: float = Field(default=0.0, ge=0.0)
    position_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    mode: DataMode = DataMode.SIMULATED


class RangeReading(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    sensor_id: str
    angle_deg: float = 0.0
    range_m: float = Field(ge=0.0)
    quality: float = Field(default=1.0, ge=0.0, le=1.0)
    mode: DataMode = DataMode.SIMULATED


class EnvironmentState(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    temperature_c: float = 26.0
    pressure_hpa: float = Field(default=1008.0, gt=0.0)
    relative_altitude_m: float = 0.0
    visibility_score: float = Field(default=1.0, ge=0.0, le=1.0)
    visibility_state: VisibilityState = VisibilityState.GOOD
    mode: DataMode = DataMode.SIMULATED


class LiveObject(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    object_id: str
    x_m: float
    y_m: float
    object_type: str = "UNKNOWN"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source: str = "TOF"
    mode: DataMode = DataMode.SIMULATED


class EmergencyState(TelemetryModel):
    state: EmergencyLevel = EmergencyLevel.SAFE
    reason: str | None = None
    nearest_obstacle_m: float | None = Field(default=None, ge=0.0)
    motor_cut: bool = False


class SensorHealth(TelemetryModel):
    sensor_id: str
    status: SensorStatus = SensorStatus.HEALTHY
    last_update_ms: int = Field(default_factory=now_ms, ge=0)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    detail: str | None = None


class WorldState(TelemetryModel):
    schema_version: Literal["1.0"] = "1.0"
    generated_at_ms: int = Field(default_factory=now_ms, ge=0)
    sequence: int = Field(default=0, ge=0)
    mode: DataMode = DataMode.SIMULATED
    vehicle: VehiclePose = Field(default_factory=VehiclePose)
    ranges: list[RangeReading] = Field(default_factory=list)
    environment: EnvironmentState = Field(default_factory=EnvironmentState)
    live_objects: list[LiveObject] = Field(default_factory=list)
    emergency: EmergencyState = Field(default_factory=EmergencyState)
    sensor_health: list[SensorHealth] = Field(default_factory=list)


class SystemStatus(TelemetryModel):
    service: Literal["fogsen-backend"] = "fogsen-backend"
    status: Literal["ok", "degraded"] = "ok"
    version: str = "0.1.0"
    mode: DataMode = DataMode.SIMULATED
    websocket_path: str = "/ws/telemetry"
    telemetry_hz: float = 10.0
    world_sequence: int = 0

