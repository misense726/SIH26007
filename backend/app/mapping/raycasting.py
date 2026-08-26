from __future__ import annotations

import math
from dataclasses import dataclass

from backend.app.models import MapFeatureType, Point2D, ReferenceMap


@dataclass(frozen=True, slots=True)
class CircleTarget:
    target_id: str
    center: Point2D
    radius_m: float


@dataclass(frozen=True, slots=True)
class RayHit:
    distance_m: float
    target_id: str | None


Segment = tuple[Point2D, Point2D, str]


def _cross(ax: float, ay: float, bx: float, by: float) -> float:
    return ax * by - ay * bx


def _ray_segment_distance(
    origin: Point2D,
    direction_x: float,
    direction_y: float,
    start: Point2D,
    end: Point2D,
) -> float | None:
    segment_x = end.x_m - start.x_m
    segment_y = end.y_m - start.y_m
    denominator = _cross(direction_x, direction_y, segment_x, segment_y)
    if abs(denominator) < 1e-9:
        return None
    offset_x = start.x_m - origin.x_m
    offset_y = start.y_m - origin.y_m
    ray_distance = _cross(offset_x, offset_y, segment_x, segment_y) / denominator
    segment_fraction = _cross(offset_x, offset_y, direction_x, direction_y) / denominator
    if ray_distance >= 0.0 and 0.0 <= segment_fraction <= 1.0:
        return ray_distance
    return None


def _ray_circle_distance(
    origin: Point2D,
    direction_x: float,
    direction_y: float,
    target: CircleTarget,
) -> float | None:
    offset_x = origin.x_m - target.center.x_m
    offset_y = origin.y_m - target.center.y_m
    projection = offset_x * direction_x + offset_y * direction_y
    constant = offset_x**2 + offset_y**2 - target.radius_m**2
    if constant <= 0.0:
        return 0.0
    discriminant = projection**2 - constant
    if discriminant < 0.0:
        return None
    root = math.sqrt(discriminant)
    candidates = (-projection - root, -projection + root)
    positive = [distance for distance in candidates if distance >= 0.0]
    return min(positive) if positive else None


def reference_segments(reference_map: ReferenceMap) -> list[Segment]:
    segments: list[Segment] = []
    for feature in reference_map.features:
        if feature.feature_type is not MapFeatureType.BERM:
            continue
        for start, end in zip(feature.points[:-1], feature.points[1:], strict=True):
            segments.append((start, end, feature.feature_id))
    return segments


def cast_ray(
    origin: Point2D,
    bearing_deg: float,
    max_range_m: float,
    segments: list[Segment],
    circles: list[CircleTarget] | None = None,
) -> RayHit:
    radians = math.radians(bearing_deg)
    direction_x = math.sin(radians)
    direction_y = math.cos(radians)
    nearest_distance = max_range_m
    nearest_target: str | None = None

    for start, end, target_id in segments:
        distance = _ray_segment_distance(origin, direction_x, direction_y, start, end)
        if distance is not None and distance < nearest_distance:
            nearest_distance = distance
            nearest_target = target_id

    for target in circles or []:
        distance = _ray_circle_distance(origin, direction_x, direction_y, target)
        if distance is not None and distance < nearest_distance:
            nearest_distance = distance
            nearest_target = target.target_id

    return RayHit(distance_m=nearest_distance, target_id=nearest_target)
