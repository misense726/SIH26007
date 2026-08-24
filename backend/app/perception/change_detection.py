from __future__ import annotations

from collections import defaultdict

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from backend.app.models import (
    DataMode,
    LiveObject,
    LiveObjectType,
    MapFeatureType,
    ObjectSource,
    ReferenceMap,
    SpatialPoint,
    VehiclePose,
)


class ChangeDetector:
    def __init__(self, reference_map: ReferenceMap, known_tolerance_m: float = 0.38) -> None:
        self.reference_map = reference_map
        self.known_tolerance_m = known_tolerance_m
        road_feature = reference_map.feature(MapFeatureType.ROAD)
        if road_feature is None:
            raise ValueError("Reference map requires a ROAD feature")
        self.road = Polygon([(point.x_m, point.y_m) for point in road_feature.points]).buffer(0)

        known_geometry = []
        for feature in reference_map.features:
            coordinates = [(point.x_m, point.y_m) for point in feature.points]
            if feature.feature_type is MapFeatureType.BERM:
                known_geometry.append(LineString(coordinates).buffer(known_tolerance_m))
            elif feature.feature_type is MapFeatureType.STATIC_OBSTACLE:
                radius = float(feature.properties.get("radius_m", 0.3))
                known_geometry.append(Point(coordinates[0]).buffer(radius + known_tolerance_m))
        self.known_geometry = unary_union(known_geometry)

    def detect(
        self,
        points: list[SpatialPoint],
        pose: VehiclePose,
        timestamp_ms: int,
        mode: DataMode,
        max_age_ms: int = 1_800,
    ) -> list[LiveObject]:
        clusters: dict[tuple[str, int, int], list[SpatialPoint]] = defaultdict(list)
        cutoff = timestamp_ms - max_age_ms
        for spatial_point in points:
            if spatial_point.timestamp_ms < cutoff or spatial_point.quality < 0.45:
                continue
            geometry_point = Point(spatial_point.x_m, spatial_point.y_m)
            if self.known_geometry.contains(geometry_point):
                continue
            object_type = (
                LiveObjectType.UNKNOWN_OBSTACLE
                if self.road.contains(geometry_point)
                else LiveObjectType.MAP_MISMATCH
            )
            key = (
                object_type.value,
                round(spatial_point.x_m / 0.65),
                round(spatial_point.y_m / 0.65),
            )
            clusters[key].append(spatial_point)

        objects: list[LiveObject] = []
        for (object_type_value, column, row), cluster in clusters.items():
            if len(cluster) < 2:
                continue
            x_m = sum(point.x_m for point in cluster) / len(cluster)
            y_m = sum(point.y_m for point in cluster) / len(cluster)
            confidence = min(0.98, 0.5 + len(cluster) * 0.07)
            objects.append(
                LiveObject(
                    timestamp_ms=timestamp_ms,
                    object_id=f"change-{object_type_value.lower()}-{column}-{row}",
                    x_m=x_m,
                    y_m=y_m,
                    object_type=LiveObjectType(object_type_value),
                    confidence=confidence,
                    source=ObjectSource.TOF,
                    mode=mode,
                )
            )

            distance = ((x_m - pose.x_m) ** 2 + (y_m - pose.y_m) ** 2) ** 0.5
            if distance <= 1.25:
                objects.append(
                    LiveObject(
                        timestamp_ms=timestamp_ms,
                        object_id=f"proximity-{column}-{row}",
                        x_m=x_m,
                        y_m=y_m,
                        object_type=LiveObjectType.PROXIMITY,
                        confidence=confidence,
                        source=ObjectSource.TOF,
                        mode=mode,
                    )
                )
        return objects
