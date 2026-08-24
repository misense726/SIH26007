from __future__ import annotations

import pytest

from backend.app.localization.fusion import LocalizationFusion
from backend.app.models import DataMode, VehiclePose
from backend.app.providers.base import IMUSample, OdometrySample


def samples(distance_m: float) -> tuple[OdometrySample, IMUSample]:
    return (
        OdometrySample(
            timestamp_ms=1000,
            left_distance_m=distance_m,
            right_distance_m=distance_m,
            confidence=0.9,
        ),
        IMUSample(
            timestamp_ms=1000,
            heading_deg=0.0,
            yaw_rate_dps=0.0,
            acceleration_mps2=0.0,
            confidence=0.92,
        ),
    )


def test_absolute_provider_initializes_normalized_pose() -> None:
    fusion = LocalizationFusion()
    odometry, imu = samples(0.0)
    pose = fusion.update(
        timestamp_ms=1000,
        odometry=odometry,
        imu=imu,
        absolute_pose=VehiclePose(x_m=4.0, y_m=5.0, heading_deg=10.0),
        speed_mps=1.0,
        mode=DataMode.SIMULATED,
    )
    assert pose.x_m == 4.0
    assert pose.y_m == 5.0


def test_odometry_continues_when_absolute_provider_is_missing() -> None:
    fusion = LocalizationFusion()
    odometry, imu = samples(0.0)
    fusion.update(1000, odometry, imu, VehiclePose(x_m=2, y_m=3), 1.0, DataMode.SIMULATED)
    moved_odometry, moved_imu = samples(1.0)
    pose = fusion.update(
        2000,
        moved_odometry,
        moved_imu,
        absolute_pose=None,
        speed_mps=1.0,
        mode=DataMode.SIMULATED,
    )
    assert pose.x_m == pytest.approx(2.0)
    assert pose.y_m == pytest.approx(4.0)
    assert pose.position_confidence < 0.9
