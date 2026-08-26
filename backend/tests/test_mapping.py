from __future__ import annotations

import pytest

from backend.app.mapping.occupancy import OccupancyAccumulator
from backend.app.mapping.raycasting import CircleTarget, cast_ray
from backend.app.mapping.transforms import (
    SensorTransform,
    range_reading_to_world,
    range_to_sensor_xy,
)
from backend.app.models import Point2D, RangeReading, VehiclePose


def test_range_to_xy_matches_frozen_coordinate_rule() -> None:
    forward = range_to_sensor_xy(2.0, 0.0)
    right = range_to_sensor_xy(2.0, 90.0)
    assert forward.x_m == pytest.approx(0.0)
    assert forward.y_m == pytest.approx(2.0)
    assert right.x_m == pytest.approx(2.0)
    assert right.y_m == pytest.approx(0.0)


def test_sensor_and_vehicle_transforms_reach_world_coordinates() -> None:
    reading = RangeReading(sensor_id="front", range_m=2.0, angle_deg=0.0)
    transform = SensorTransform("front", x_m=0.0, y_m=0.5, orientation_deg=0.0)
    pose = VehiclePose(x_m=4.0, y_m=5.0, heading_deg=90.0)
    point = range_reading_to_world(reading, transform, pose)
    assert point.x_m == pytest.approx(6.5)
    assert point.y_m == pytest.approx(5.0)


def test_ray_cast_hits_circle_before_boundary() -> None:
    origin = Point2D(x_m=0.0, y_m=0.0)
    segments = [(Point2D(x_m=-2, y_m=5), Point2D(x_m=2, y_m=5), "berm")]
    circle = CircleTarget("obstacle", Point2D(x_m=0, y_m=3), radius_m=0.5)
    hit = cast_ray(origin, 0.0, 8.0, segments, [circle])
    assert hit.target_id == "obstacle"
    assert hit.distance_m == pytest.approx(2.5)


def test_ray_cast_origin_inside_circle_reports_immediate_hit() -> None:
    origin = Point2D(x_m=0.0, y_m=0.0)
    circle = CircleTarget("overlap", Point2D(x_m=0.1, y_m=0.1), radius_m=0.5)
    hit = cast_ray(origin, 0.0, 4.0, [], [circle])
    assert hit.target_id == "overlap"
    assert hit.distance_m == 0.0


def test_occupancy_accumulates_valid_hits_only() -> None:
    accumulator = OccupancyAccumulator(
        {"front": SensorTransform("front", 0, 0, 0)},
        resolution_m=0.5,
        width=20,
        height=20,
    )
    pose = VehiclePose(x_m=2, y_m=2)
    readings = [
        RangeReading(sensor_id="front", range_m=2, max_range_m=4),
        RangeReading(sensor_id="front", range_m=4, max_range_m=4, is_valid=False),
    ]
    points = accumulator.add(readings, pose)
    state = accumulator.state(readings[0].timestamp_ms)
    assert len(points) == 1
    assert len(state.occupied_cells) == 1
