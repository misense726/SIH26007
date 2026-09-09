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
    def __init__(self, points: list[Point2D], corner_blend_m: float = 0.0) -> None:
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
        self._corners = []
        distance = 0.0
        for i in range(1, len(points) - 1):
            distance += self.segment_lengths[i - 1]
            span = min(corner_blend_m, self.segment_lengths[i - 1] * 0.45,
                       self.segment_lengths[i] * 0.45)
            if span > 0:
                self._corners.append((distance, span, i))
        if points[0] == points[-1] and corner_blend_m > 0:
            span = min(corner_blend_m, self.segment_lengths[-1] * 0.45,
                       self.segment_lengths[0] * 0.45)
            self._corners.append((0.0, span, 0))

    def sample(self, distance_m: float) -> RouteSample:
        remaining = max(0.0, min(distance_m, self.total_length_m))
        for distance, span, i in self._corners:
            offset = remaining - distance
            if i == 0 and offset > self.total_length_m / 2:
                offset -= self.total_length_m
            if abs(offset) <= span:
                before = self.points[i - 1] if i else self.points[-2]
                corner, after = self.points[i:i + 2]
                ux = (corner.x_m - before.x_m) / self.segment_lengths[i - 1]
                uy = (corner.y_m - before.y_m) / self.segment_lengths[i - 1]
                vx = (after.x_m - corner.x_m) / self.segment_lengths[i]
                vy = (after.y_m - corner.y_m) / self.segment_lengths[i]
                t = (offset + span) / (2 * span)
                # A quadratic joins both straight segments with matching tangents.
                return RouteSample(
                    x_m=corner.x_m + span * (t * t * vx - (1 - t) ** 2 * ux),
                    y_m=corner.y_m + span * (t * t * vy - (1 - t) ** 2 * uy),
                    heading_deg=math.degrees(math.atan2(
                        (1 - t) * ux + t * vx, (1 - t) * uy + t * vy
                    )) % 360,
                )
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
