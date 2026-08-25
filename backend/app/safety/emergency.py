from __future__ import annotations

from dataclasses import dataclass

from backend.app.models import EmergencyLevel, EmergencyState, RangeReading


FRONT_SENSORS = {"front_scanner", "front_left", "front_right"}


@dataclass(frozen=True, slots=True)
class SafetyParameters:
    warning_time_s: float
    critical_time_s: float
    emergency_time_s: float
    stationary_warning_m: float
    stationary_critical_m: float
    stationary_emergency_m: float
    reaction_time_s: float
    braking_deceleration_mps2: float
    confidence_floor: float
    stale_sensor_ms: int
    emergency_persistence_ms: int
    safety_margin_m: float = 0.25

    @classmethod
    def from_config(cls, config: dict) -> "SafetyParameters":
        values = config["safety"]
        return cls(
            warning_time_s=float(values["warning_time_s"]),
            critical_time_s=float(values["critical_time_s"]),
            emergency_time_s=float(values["emergency_time_s"]),
            stationary_warning_m=float(values["stationary_warning_m"]),
            stationary_critical_m=float(values["stationary_critical_m"]),
            stationary_emergency_m=float(values["stationary_emergency_m"]),
            reaction_time_s=float(values["reaction_time_s"]),
            braking_deceleration_mps2=float(values["braking_deceleration_mps2"]),
            confidence_floor=float(values["confidence_floor"]),
            stale_sensor_ms=int(values["stale_sensor_ms"]),
            emergency_persistence_ms=int(values["emergency_persistence_ms"]),
        )


@dataclass(frozen=True, slots=True)
class SafetyDistances:
    warning_m: float
    critical_m: float
    emergency_m: float


class EmergencyController:
    def __init__(self, parameters: SafetyParameters) -> None:
        self.parameters = parameters
        self._emergency_candidate_since_ms: int | None = None
        self._latched_at_ms: int | None = None

    def reset(self) -> None:
        self._emergency_candidate_since_ms = None
        self._latched_at_ms = None

    def distances(self, speed_mps: float) -> SafetyDistances:
        braking_distance = speed_mps**2 / (2.0 * self.parameters.braking_deceleration_mps2)
        reaction_distance = speed_mps * self.parameters.reaction_time_s
        physics_warning = reaction_distance + braking_distance + self.parameters.safety_margin_m
        return SafetyDistances(
            warning_m=max(
                self.parameters.stationary_warning_m,
                speed_mps * self.parameters.warning_time_s,
                physics_warning,
            ),
            critical_m=max(
                self.parameters.stationary_critical_m,
                speed_mps * self.parameters.critical_time_s,
                braking_distance + self.parameters.safety_margin_m,
            ),
            emergency_m=max(
                self.parameters.stationary_emergency_m,
                speed_mps * self.parameters.emergency_time_s,
            ),
        )

    def evaluate(
        self,
        timestamp_ms: int,
        speed_mps: float,
        readings: list[RangeReading],
    ) -> EmergencyState:
        distances = self.distances(speed_mps)
        valid = [
            reading
            for reading in readings
            if reading.sensor_id in FRONT_SENSORS
            and reading.is_valid
            and reading.quality >= self.parameters.confidence_floor
            and timestamp_ms - reading.timestamp_ms <= self.parameters.stale_sensor_ms
        ]
        detected = [
            reading for reading in valid if reading.range_m < reading.max_range_m - 0.01
        ]
        nearest = (
            min(reading.range_m for reading in detected)
            if detected
            else max((reading.max_range_m for reading in valid), default=None)
        )
        confidence = min((reading.quality for reading in valid), default=0.0)

        if self._latched_at_ms is not None:
            return EmergencyState(
                state=EmergencyLevel.EMERGENCY_STOP,
                reason="Emergency stop remains latched until reset",
                nearest_obstacle_m=nearest,
                critical_distance_m=distances.critical_m,
                confidence=confidence,
                motor_cut=True,
                latched_at_ms=self._latched_at_ms,
            )

        if not valid:
            self._emergency_candidate_since_ms = None
            return EmergencyState(
                state=EmergencyLevel.WARNING,
                reason="Forward range data is unavailable or stale",
                critical_distance_m=distances.critical_m,
                confidence=0.0,
            )

        assert nearest is not None
        if nearest <= distances.emergency_m:
            if self._emergency_candidate_since_ms is None:
                self._emergency_candidate_since_ms = timestamp_ms
            persisted = timestamp_ms - self._emergency_candidate_since_ms
            if persisted >= self.parameters.emergency_persistence_ms:
                self._latched_at_ms = self._emergency_candidate_since_ms
                return EmergencyState(
                    state=EmergencyLevel.EMERGENCY_STOP,
                    reason="Forward obstacle is inside the deterministic stop threshold",
                    nearest_obstacle_m=nearest,
                    critical_distance_m=distances.critical_m,
                    confidence=confidence,
                    motor_cut=True,
                    latched_at_ms=self._latched_at_ms,
                )
            return EmergencyState(
                state=EmergencyLevel.CRITICAL,
                reason="Emergency threshold crossed; persistence check active",
                nearest_obstacle_m=nearest,
                critical_distance_m=distances.critical_m,
                confidence=confidence,
            )

        self._emergency_candidate_since_ms = None
        if nearest <= distances.critical_m:
            level = EmergencyLevel.CRITICAL
            reason = "Forward obstacle is inside the critical stopping distance"
        elif nearest <= distances.warning_m:
            level = EmergencyLevel.WARNING
            reason = "Forward obstacle is inside the warning distance"
        else:
            level = EmergencyLevel.SAFE
            reason = None
        return EmergencyState(
            state=level,
            reason=reason,
            nearest_obstacle_m=nearest,
            critical_distance_m=distances.critical_m,
            confidence=confidence,
        )
