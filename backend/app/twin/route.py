from __future__ import annotations

import math
from dataclasses import dataclass

from backend.app.models import Point2D


@dataclass(frozen=True, slots=True)
class RouteSample:
    x_m: float
    y_m: float
    heading_deg: float


class PolylineRoute:
    def __init__(self, points: list[Point2D]) -> None:
        if len(points) < 2:
            raise ValueError("A route needs at least two points")
        self.points = tuple(points)
        self.segment_lengths = tuple(
            math.hypot(end.x_m - start.x_m, end.y_m - start.y_m)
            for start, end in zip(self.points[:-1], self.points[1:], strict=True)
        )
        if any(length <= 0 for length in self.segment_lengths):
            raise ValueError("A route cannot contain duplicate consecutive points")
        self.total_length_m = sum(self.segment_lengths)

    def sample(self, distance_m: float) -> RouteSample:
        remaining = distance_m % self.total_length_m
        for index, segment_length in enumerate(self.segment_lengths):
            if remaining <= segment_length or index == len(self.segment_lengths) - 1:
                start = self.points[index]
                end = self.points[index + 1]
                fraction = min(1.0, remaining / segment_length)
                dx = end.x_m - start.x_m
                dy = end.y_m - start.y_m
                return RouteSample(
                    x_m=start.x_m + dx * fraction,
                    y_m=start.y_m + dy * fraction,
                    heading_deg=math.degrees(math.atan2(dx, dy)) % 360.0,
                )
            remaining -= segment_length
        raise RuntimeError("Route sampling failed")
