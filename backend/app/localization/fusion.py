from __future__ import annotations

import math

from backend.app.models import DataMode, VehiclePose
from backend.app.providers.base import IMUSample, OdometrySample


def _heading_blend(first_deg: float, second_deg: float, second_weight: float) -> float:
    delta = (second_deg - first_deg + 180.0) % 360.0 - 180.0
    return (first_deg + delta * second_weight) % 360.0


class LocalizationFusion:
    """Fuse absolute position, wheel odometry, and IMU behind one pose contract."""

    def __init__(self, vehicle_id: str = "DUMPER_01") -> None:
        self.vehicle_id = vehicle_id
        self._pose: VehiclePose | None = None
        self._last_odometry: OdometrySample | None = None

    def update(
        self,
        timestamp_ms: int,
        odometry: OdometrySample,
        imu: IMUSample,
        absolute_pose: VehiclePose | None,
        speed_mps: float,
        mode: DataMode,
    ) -> VehiclePose:
        if self._pose is None:
            base = absolute_pose or VehiclePose(
                timestamp_ms=timestamp_ms,
                vehicle_id=self.vehicle_id,
                heading_deg=imu.heading_deg,
                position_confidence=min(odometry.confidence, imu.confidence) * 0.6,
                mode=mode,
            )
            self._pose = base.model_copy(
                update={"timestamp_ms": timestamp_ms, "speed_mps": speed_mps, "mode": mode}
            )
            self._last_odometry = odometry
            return self._pose.model_copy(deep=True)

        distance_delta = 0.0
        if self._last_odometry is not None:
            left_delta = odometry.left_distance_m - self._last_odometry.left_distance_m
            right_delta = odometry.right_distance_m - self._last_odometry.right_distance_m
            distance_delta = (left_delta + right_delta) * 0.5

        heading = _heading_blend(self._pose.heading_deg, imu.heading_deg, 0.72)
        heading_radians = math.radians(heading)
        predicted_x = self._pose.x_m + math.sin(heading_radians) * distance_delta
        predicted_y = self._pose.y_m + math.cos(heading_radians) * distance_delta
        confidence = min(odometry.confidence, imu.confidence) * 0.78

        if absolute_pose is not None:
            absolute_weight = min(0.9, max(0.45, absolute_pose.position_confidence * 0.82))
            predicted_x = predicted_x * (1.0 - absolute_weight) + absolute_pose.x_m * absolute_weight
            predicted_y = predicted_y * (1.0 - absolute_weight) + absolute_pose.y_m * absolute_weight
            heading = _heading_blend(heading, absolute_pose.heading_deg, absolute_weight * 0.65)
            confidence = min(
                1.0,
                0.25 * odometry.confidence
                + 0.2 * imu.confidence
                + 0.55 * absolute_pose.position_confidence,
            )

        self._pose = VehiclePose(
            timestamp_ms=timestamp_ms,
            vehicle_id=self.vehicle_id,
            x_m=predicted_x,
            y_m=predicted_y,
            heading_deg=heading,
            speed_mps=speed_mps,
            position_confidence=confidence,
            mode=mode,
        )
        self._last_odometry = odometry
        return self._pose.model_copy(deep=True)
