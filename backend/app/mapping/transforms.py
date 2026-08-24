from __future__ import annotations

import math
from dataclasses import dataclass

from backend.app.models import Point2D, RangeReading, SpatialPoint, VehiclePose


@dataclass(frozen=True, slots=True)
class SensorTransform:
    sensor_id: str
    x_m: float
    y_m: float
    orientation_deg: float


def range_to_sensor_xy(range_m: float, angle_deg: float) -> Point2D:
    """Convert a clockwise bearing from forward into the sensor frame."""
    radians = math.radians(angle_deg)
    return Point2D(
        x_m=range_m * math.sin(radians),
        y_m=range_m * math.cos(radians),
    )


def rotate_clockwise(point: Point2D, angle_deg: float) -> Point2D:
    """Rotate an X-right/Y-forward vector clockwise from positive Y."""
    radians = math.radians(angle_deg)
    cosine = math.cos(radians)
    sine = math.sin(radians)
    return Point2D(
        x_m=point.x_m * cosine + point.y_m * sine,
        y_m=-point.x_m * sine + point.y_m * cosine,
    )


def sensor_to_vehicle(point: Point2D, transform: SensorTransform) -> Point2D:
    rotated = rotate_clockwise(point, transform.orientation_deg)
    return Point2D(
        x_m=transform.x_m + rotated.x_m,
        y_m=transform.y_m + rotated.y_m,
    )


def vehicle_to_world(point: Point2D, pose: VehiclePose) -> Point2D:
    rotated = rotate_clockwise(point, pose.heading_deg)
    return Point2D(x_m=pose.x_m + rotated.x_m, y_m=pose.y_m + rotated.y_m)


def sensor_origin_world(transform: SensorTransform, pose: VehiclePose) -> Point2D:
    return vehicle_to_world(Point2D(x_m=transform.x_m, y_m=transform.y_m), pose)


def range_reading_to_world(
    reading: RangeReading,
    transform: SensorTransform,
    pose: VehiclePose,
    height_hint_m: float = 0.8,
) -> SpatialPoint:
    sensor_point = range_to_sensor_xy(reading.range_m, reading.angle_deg)
    vehicle_point = sensor_to_vehicle(sensor_point, transform)
    world_point = vehicle_to_world(vehicle_point, pose)
    return SpatialPoint(
        x_m=world_point.x_m,
        y_m=world_point.y_m,
        height_hint_m=height_hint_m,
        source_sensor_id=reading.sensor_id,
        quality=reading.quality,
        timestamp_ms=reading.timestamp_ms,
    )


def transforms_from_config(config: dict) -> dict[str, SensorTransform]:
    transforms: dict[str, SensorTransform] = {}
    for sensor_id, sensor in config["sensors"].items():
        position = sensor["position_m"]
        transforms[sensor_id] = SensorTransform(
            sensor_id=sensor_id,
            x_m=float(position[0]),
            y_m=float(position[1]),
            orientation_deg=float(sensor["orientation_deg"]),
        )
    return transforms
