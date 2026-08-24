from __future__ import annotations

from collections import Counter, deque

from backend.app.models import GridCell, OccupancyState, Point2D, RangeReading, SpatialPoint, VehiclePose
from backend.app.mapping.transforms import SensorTransform, range_reading_to_world


class OccupancyAccumulator:
    def __init__(
        self,
        transforms: dict[str, SensorTransform],
        resolution_m: float = 0.25,
        origin: Point2D | None = None,
        width: int = 80,
        height: int = 128,
        max_points: int = 900,
    ) -> None:
        self.transforms = transforms
        self.resolution_m = resolution_m
        self.origin = origin or Point2D(x_m=0.0, y_m=0.0)
        self.width = width
        self.height = height
        self.points: deque[SpatialPoint] = deque(maxlen=max_points)

    def clear(self) -> None:
        self.points.clear()

    def add(self, readings: list[RangeReading], pose: VehiclePose) -> list[SpatialPoint]:
        new_points: list[SpatialPoint] = []
        for reading in readings:
            transform = self.transforms.get(reading.sensor_id)
            if (
                transform is None
                or not reading.is_valid
                or reading.quality < 0.35
                or reading.range_m >= reading.max_range_m - 0.01
            ):
                continue
            point = range_reading_to_world(reading, transform, pose)
            self.points.append(point)
            new_points.append(point)
        return new_points

    def recent_points(self, timestamp_ms: int, age_ms: int = 12_000) -> list[SpatialPoint]:
        cutoff = timestamp_ms - age_ms
        return [point for point in self.points if point.timestamp_ms >= cutoff]

    def state(self, timestamp_ms: int) -> OccupancyState:
        counts: Counter[tuple[int, int]] = Counter()
        for point in self.recent_points(timestamp_ms):
            column = int((point.x_m - self.origin.x_m) / self.resolution_m)
            row = int((point.y_m - self.origin.y_m) / self.resolution_m)
            if 0 <= column < self.width and 0 <= row < self.height:
                counts[(column, row)] += 1
        cells = [
            GridCell(column=column, row=row, hit_count=count)
            for (column, row), count in counts.most_common(420)
        ]
        return OccupancyState(
            resolution_m=self.resolution_m,
            origin=self.origin,
            width=self.width,
            height=self.height,
            occupied_cells=cells,
            updated_at_ms=timestamp_ms,
        )
