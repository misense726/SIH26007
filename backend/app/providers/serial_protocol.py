from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.app.models import (
    DataMode,
    EmergencyLevel,
    EmergencyState,
    EnvironmentState,
    MotionState,
    RangeReading,
    SensorHealth,
    SensorStatus,
)


MAX_WIRE_LINE_BYTES = 4096


class WireModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class FrontWireState(WireModel):
    state: str | None = None
    age: int | None = Field(default=None, ge=0)
    a: float | None = None
    scan: int = -1
    scan_age: int | None = Field(default=None, ge=0)
    front: int = -1
    front_age: int | None = Field(default=None, ge=0)
    ok: int = Field(default=0, ge=0)
    seq: int | None = Field(default=None, ge=0)
    dropped: int = Field(default=0, ge=0)


class RearWireState(WireModel):
    state: str | None = None
    age: int | None = Field(default=None, ge=0)
    a: float | None = None
    scan: int = -1
    scan_age: int | None = Field(default=None, ge=0)
    left: int = -1
    left_age: int | None = Field(default=None, ge=0)
    right: int = -1
    right_age: int | None = Field(default=None, ge=0)
    ok: int = Field(default=0, ge=0)
    seq: int | None = Field(default=None, ge=0)
    dropped: int = Field(default=0, ge=0)


class IMUWireState(WireModel):
    state: str | None = None
    age: int | None = Field(default=None, ge=0)
    ax: float | None = None
    ay: float | None = None
    az: float | None = None
    gx: float | None = None
    gy: float | None = None
    gz: float | None = None
    heading: float | None = None


class EnvironmentWireState(WireModel):
    state: str | None = None
    age: int | None = Field(default=None, ge=0)
    temp: float | None = None
    pressure: float | None = Field(default=None, gt=0.0)
    rel_alt: float | None = None


class WheelWireState(WireModel):
    enabled: bool | int = True
    l: int = Field(ge=0)
    r: int = Field(ge=0)
    speed: float = Field(default=0.0, ge=0.0)
    ls: float | None = Field(default=None, ge=0.0)
    rs: float | None = Field(default=None, ge=0.0)
    left_m: float | None = Field(default=None, ge=0.0)
    right_m: float | None = Field(default=None, ge=0.0)


class EmergencyWireState(WireModel):
    state: str
    cut: bool | int
    output_enabled: bool | int = True
    cut_requested: bool | int | None = None
    coverage: bool | None = None
    nearest_mm: int | None = None
    nearest: float | None = Field(default=None, ge=0.0)
    critical: float | None = Field(default=None, ge=0.0)
    latched: bool | int = False
    latched_ms: int | None = Field(default=None, ge=0)
    reason: str | None = None


class MainTelemetryPacket(WireModel):
    type: Literal["telemetry"] | None = None
    seq: int | None = Field(default=None, ge=0)
    ms: int = Field(ge=0)
    front: FrontWireState
    rear: RearWireState
    imu: IMUWireState
    env: EnvironmentWireState
    wheel: WheelWireState
    estop: EmergencyWireState


class WireProtocolError(ValueError):
    pass


def parse_main_packet(line: bytes | str) -> MainTelemetryPacket:
    encoded = line.encode("utf-8") if isinstance(line, str) else line
    if len(encoded) > MAX_WIRE_LINE_BYTES:
        raise WireProtocolError("MAIN telemetry line exceeds the 4096-byte limit")
    try:
        payload = json.loads(encoded)
        return MainTelemetryPacket.model_validate(payload)
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, TypeError) as exc:
        raise WireProtocolError(f"Invalid MAIN telemetry packet: {exc}") from exc


class BoundedLineBuffer:
    """Split USB serial input into lines without blocking or unbounded growth."""

    def __init__(self, maximum_bytes: int = MAX_WIRE_LINE_BYTES) -> None:
        self.maximum_bytes = maximum_bytes
        self._buffer = bytearray()
        self._discarding = False
        self.discarded_lines = 0

    def feed(self, chunk: bytes) -> list[bytes]:
        lines: list[bytes] = []
        for byte in chunk:
            if byte == 10:
                if self._discarding:
                    self._discarding = False
                    self._buffer.clear()
                    continue
                if self._buffer:
                    lines.append(bytes(self._buffer).rstrip(b"\r"))
                self._buffer.clear()
                continue
            if self._discarding:
                continue
            if len(self._buffer) >= self.maximum_bytes:
                self._buffer.clear()
                self._discarding = True
                self.discarded_lines += 1
                continue
            self._buffer.append(byte)
        return lines


@dataclass(frozen=True, slots=True)
class LiveSerialSample:
    controller_ms: int
    speed_mps: float
    ranges: list[RangeReading]
    sensor_health: list[SensorHealth]
    motion: MotionState
    environment: EnvironmentState
    emergency: EmergencyState


def _range(
    sensor_id: str,
    millimetres: int,
    angle_deg: float,
    timestamp_ms: int,
    maximum_m: float,
    available: bool,
) -> RangeReading:
    valid_value = 1 <= millimetres <= maximum_m * 1000
    valid = available and valid_value
    range_m = millimetres / 1000.0 if valid else 0.0
    return RangeReading(
        timestamp_ms=timestamp_ms,
        sensor_id=sensor_id,
        angle_deg=angle_deg,
        range_m=range_m,
        quality=1.0 if valid else 0.0,
        max_range_m=maximum_m,
        is_valid=valid,
        mode=DataMode.LIVE,
    )


def _node_is_fresh(age: int | None, state: str | None, stale_timeout_ms: int) -> bool:
    normalized = state.upper() if state else None
    return (
        age is not None
        and age <= stale_timeout_ms
        and normalized not in {"OFFLINE", "STALE"}
    )


def _component_is_healthy(
    node_ok: int,
    required_bits: int,
    allowed_bits: int,
    state: str | None,
) -> bool:
    normalized = state.upper() if state else None
    if (
        normalized not in {None, "HEALTHY", "DEGRADED"}
        or node_ok == 0
        or node_ok & ~allowed_bits
    ):
        return False
    return (node_ok & required_bits) == required_bits


def _health(
    sensor_id: str,
    timestamp_ms: int,
    age: int | None,
    fresh: bool,
    node_state: str | None,
    component_healthy: bool,
) -> SensorHealth:
    normalized = node_state.upper() if node_state else None
    if age is None or normalized == "OFFLINE":
        status = SensorStatus.OFFLINE
        confidence = 0.0
        detail = "No node telemetry has been received"
    elif not fresh:
        status = SensorStatus.STALE
        confidence = 0.0
        detail = "Node packet age exceeded the configured stale timeout"
    elif not component_healthy:
        status = SensorStatus.DEGRADED
        confidence = 0.45
        detail = "Node health mask reports this component as degraded"
    else:
        status = SensorStatus.HEALTHY
        confidence = 1.0
        detail = None
    return SensorHealth(
        sensor_id=sensor_id,
        status=status,
        last_update_ms=timestamp_ms,
        confidence=confidence,
        detail=detail,
    )


def _local_health(
    sensor_id: str,
    timestamp_ms: int,
    state: str | None,
    age: int | None,
    has_values: bool,
) -> SensorHealth:
    normalized = state.upper() if state else ("HEALTHY" if has_values else "OFFLINE")
    if normalized == "HEALTHY" and has_values:
        status = SensorStatus.HEALTHY
        confidence = 1.0
        detail = None
    elif normalized == "STALE":
        status = SensorStatus.STALE
        confidence = 0.0
        detail = "MAIN reports stale local sensor data"
    elif normalized == "OFFLINE":
        status = SensorStatus.OFFLINE
        confidence = 0.0
        detail = "MAIN reports the local sensor offline"
    else:
        status = SensorStatus.DEGRADED
        confidence = 0.4
        detail = f"MAIN reports local sensor state {normalized}"
    return SensorHealth(
        sensor_id=sensor_id,
        status=status,
        last_update_ms=max(0, timestamp_ms - (age or 0)),
        confidence=confidence,
        detail=detail,
    )


def translate_main_packet(
    packet: MainTelemetryPacket,
    received_at_ms: int,
    stale_timeout_ms: int = 500,
    distance_per_tick_m: float = 0.11,
) -> LiveSerialSample:
    front_ages = {
        "front_scanner": (
            packet.front.scan_age
            if packet.front.scan_age is not None
            else packet.front.age
        ),
        "front_fixed": (
            packet.front.front_age
            if packet.front.front_age is not None
            else packet.front.age
        ),
    }
    rear_ages = {
        "rear_scanner": (
            packet.rear.scan_age
            if packet.rear.scan_age is not None
            else packet.rear.age
        ),
        "left_side": (
            packet.rear.left_age
            if packet.rear.left_age is not None
            else packet.rear.age
        ),
        "right_side": (
            packet.rear.right_age
            if packet.rear.right_age is not None
            else packet.rear.age
        ),
    }
    sensor_ages = front_ages | rear_ages
    sensor_freshness = {
        sensor_id: _node_is_fresh(age, packet.front.state, stale_timeout_ms)
        for sensor_id, age in front_ages.items()
    } | {
        sensor_id: _node_is_fresh(age, packet.rear.state, stale_timeout_ms)
        for sensor_id, age in rear_ages.items()
    }
    sensor_timestamps = {
        sensor_id: max(0, received_at_ms - (age or 0))
        for sensor_id, age in sensor_ages.items()
    }
    front_components = {
        "front_scanner": _component_is_healthy(
            packet.front.ok, (1 << 0) | (1 << 3), 0x0B, packet.front.state
        ),
        "front_fixed": _component_is_healthy(
            packet.front.ok, 1 << 1, 0x0B, packet.front.state
        ),
    }
    rear_components = {
        "rear_scanner": _component_is_healthy(
            packet.rear.ok, (1 << 0) | (1 << 3), 0x0F, packet.rear.state
        ),
        "left_side": _component_is_healthy(
            packet.rear.ok, 1 << 1, 0x0F, packet.rear.state
        ),
        "right_side": _component_is_healthy(
            packet.rear.ok, 1 << 2, 0x0F, packet.rear.state
        ),
    }
    ranges = [
        _range(
            "front_scanner",
            packet.front.scan,
            packet.front.a or 0.0,
            sensor_timestamps["front_scanner"],
            4.0,
            sensor_freshness["front_scanner"]
            and front_components["front_scanner"],
        ),
        _range(
            "front_fixed",
            packet.front.front,
            0.0,
            sensor_timestamps["front_fixed"],
            2.0,
            sensor_freshness["front_fixed"] and front_components["front_fixed"],
        ),
        _range(
            "rear_scanner",
            packet.rear.scan,
            packet.rear.a or 0.0,
            sensor_timestamps["rear_scanner"],
            4.0,
            sensor_freshness["rear_scanner"]
            and rear_components["rear_scanner"],
        ),
        _range(
            "left_side",
            packet.rear.left,
            0.0,
            sensor_timestamps["left_side"],
            2.0,
            sensor_freshness["left_side"] and rear_components["left_side"],
        ),
        _range(
            "right_side",
            packet.rear.right,
            0.0,
            sensor_timestamps["right_side"],
            2.0,
            sensor_freshness["right_side"] and rear_components["right_side"],
        ),
    ]
    sensor_health = [
        _health(
            sensor_id,
            sensor_timestamps[sensor_id],
            sensor_ages[sensor_id],
            sensor_freshness[sensor_id],
            packet.front.state,
            front_components[sensor_id],
        )
        for sensor_id in ("front_scanner", "front_fixed")
    ] + [
        _health(
            sensor_id,
            sensor_timestamps[sensor_id],
            sensor_ages[sensor_id],
            sensor_freshness[sensor_id],
            packet.rear.state,
            rear_components[sensor_id],
        )
        for sensor_id in ("rear_scanner", "left_side", "right_side")
    ]
    sensor_health.extend(
        (
            _local_health(
                "mpu6050",
                received_at_ms,
                packet.imu.state,
                packet.imu.age,
                packet.imu.gz is not None,
            ),
            _local_health(
                "bmp280",
                received_at_ms,
                packet.env.state,
                packet.env.age,
                packet.env.pressure is not None,
            ),
        )
    )

    raw_state = packet.estop.state.upper()
    if raw_state == "SENSOR_FAULT":
        emergency_level = EmergencyLevel.WARNING
        reason = packet.estop.reason or "MAIN controller reports a sensor fault"
    else:
        try:
            emergency_level = EmergencyLevel(raw_state)
        except ValueError:
            emergency_level = EmergencyLevel.WARNING
            reason = f"MAIN controller reported unknown stop state: {raw_state}"
        else:
            reason = packet.estop.reason
    front_health = {
        health.sensor_id: health for health in sensor_health[:2]
    }
    front_ranges = {reading.sensor_id: reading for reading in ranges[:2]}
    observed_front_coverage = all(
        front_ranges[sensor_id].is_valid
        and front_health[sensor_id].status is SensorStatus.HEALTHY
        for sensor_id in ("front_scanner", "front_fixed")
    )
    # MAIN owns the deterministic motor-safety decision. Its scanner evidence
    # can remain valid while the live scanner sample is outside the forward
    # sector, so current dashboard readings cannot reconstruct this decision.
    # Keep the local check only for older packets that lack the explicit field.
    forward_components_healthy = all(
        front_health[sensor_id].status is SensorStatus.HEALTHY
        for sensor_id in ("front_scanner", "front_fixed")
    )
    forward_coverage_complete = (
        bool(packet.estop.coverage) and forward_components_healthy
        if packet.estop.coverage is not None
        else observed_front_coverage
    )
    relay_output_enabled = bool(packet.estop.output_enabled)
    reported_cut = relay_output_enabled and bool(packet.estop.cut)
    reported_latched = bool(packet.estop.latched)
    if reported_cut or reported_latched:
        emergency_level = EmergencyLevel.EMERGENCY_STOP
        reason = packet.estop.reason or "MAIN controller reports a latched motor cut"
    elif emergency_level is EmergencyLevel.SAFE and not forward_coverage_complete:
        emergency_level = EmergencyLevel.WARNING
        reason = "Forward range coverage is incomplete or stale"
    nearest = packet.estop.nearest
    if (
        nearest is None
        and packet.estop.nearest_mm is not None
        and packet.estop.nearest_mm >= 0
    ):
        nearest = packet.estop.nearest_mm / 1000.0
    heading = packet.imu.heading if packet.imu.heading is not None else 0.0
    hall_enabled = bool(packet.wheel.enabled)
    left_distance = 0.0
    right_distance = 0.0
    if hall_enabled:
        left_distance = (
            packet.wheel.left_m
            if packet.wheel.left_m is not None
            else packet.wheel.l * distance_per_tick_m
        )
        right_distance = (
            packet.wheel.right_m
            if packet.wheel.right_m is not None
            else packet.wheel.r * distance_per_tick_m
        )
    imu_healthy = sensor_health[-2].status is SensorStatus.HEALTHY
    environment_temperature = (
        packet.env.temp if packet.env.temp is not None else 0.0
    )
    environment_pressure = (
        packet.env.pressure if packet.env.pressure is not None else 1008.0
    )
    relative_altitude = (
        packet.env.rel_alt if packet.env.rel_alt is not None else 0.0
    )
    return LiveSerialSample(
        controller_ms=packet.ms,
        speed_mps=packet.wheel.speed if hall_enabled else 0.0,
        ranges=ranges,
        sensor_health=sensor_health,
        motion=MotionState(
            timestamp_ms=received_at_ms,
            left_hall_ticks=packet.wheel.l,
            right_hall_ticks=packet.wheel.r,
            left_distance_m=left_distance,
            right_distance_m=right_distance,
            imu_heading_deg=heading % 360.0,
            imu_yaw_rate_dps=packet.imu.gz or 0.0,
            aruco_visible=False,
            localization_confidence=0.0,
            provider_confidence={
                "hall_odometry": 1.0 if hall_enabled else 0.0,
                "imu": 1.0 if imu_healthy else 0.0,
                "aruco": 0.0,
            },
            mode=DataMode.LIVE,
        ),
        environment=EnvironmentState(
            timestamp_ms=received_at_ms,
            temperature_c=environment_temperature,
            pressure_hpa=environment_pressure,
            relative_altitude_m=relative_altitude,
            visibility_score=0.0,
            visibility_state="VERY_LOW",
            mode=DataMode.LIVE,
        ),
        emergency=EmergencyState(
            state=emergency_level,
            reason=reason,
            nearest_obstacle_m=nearest,
            critical_distance_m=packet.estop.critical,
            motor_cut=reported_cut,
            latched_at_ms=(
                packet.estop.latched_ms
                if reported_latched and packet.estop.latched_ms is not None
                else None
            ),
        ),
    )
