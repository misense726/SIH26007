from __future__ import annotations

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from backend.app.models import (
    CorridorState,
    GeometryType,
    LiveObject,
    LiveObjectType,
    MapFeature,
    MapFeatureType,
    Point2D,
    ReferenceMap,
    SafeCorridor,
    SensorHealth,
    SensorStatus,
    VehiclePose,
)


class CorridorEvaluator:
    def __init__(
        self,
        reference_map: ReferenceMap,
        road_margin_m: float,
        obstacle_inflation_m: float,
        confidence_floor: float,
    ) -> None:
        self.reference_map = reference_map
        self.road_margin_m = road_margin_m
        self.obstacle_inflation_m = obstacle_inflation_m
        self.confidence_floor = confidence_floor
        road_feature = reference_map.feature(MapFeatureType.ROAD)
        if road_feature is None:
            raise ValueError("Reference map requires a ROAD feature")
        self.road = Polygon([(point.x_m, point.y_m) for point in road_feature.points]).buffer(0)
        self.hazard_features = [
            feature
            for feature in reference_map.features
            if feature.feature_type is MapFeatureType.HAZARD_ZONE
        ]
        self.hazards = unary_union(
            [
                Polygon([(point.x_m, point.y_m) for point in feature.points]).buffer(0)
                for feature in self.hazard_features
            ]
        )

    def evaluate(
        self,
        pose: VehiclePose,
        live_objects: list[LiveObject],
        sensor_health: list[SensorHealth],
        nearest_obstacle_m: float | None,
        warning_distance_m: float,
        critical_distance_m: float,
    ) -> SafeCorridor:
        obstacle_objects = [
            live_object
            for live_object in live_objects
            if live_object.object_type in {LiveObjectType.UNKNOWN_OBSTACLE, LiveObjectType.PROXIMITY}
        ]
        obstacle_shapes = [
            Point(live_object.x_m, live_object.y_m).buffer(self.obstacle_inflation_m)
            for live_object in obstacle_objects
        ]
        obstacles = unary_union(obstacle_shapes)
        usable = self.road.buffer(-self.road_margin_m).difference(self.hazards).difference(obstacles)
        vehicle_point = Point(pose.x_m, pose.y_m)

        polygons = list(usable.geoms) if hasattr(usable, "geoms") else [usable]
        selected = next((polygon for polygon in polygons if polygon.covers(vehicle_point)), None)
        if selected is None and polygons:
            selected = min(polygons, key=lambda polygon: polygon.distance(vehicle_point))

        exclusions = list(self.hazard_features)
        exclusions.extend(
            MapFeature(
                feature_id=f"corridor-{live_object.object_id}",
                feature_type=MapFeatureType.STATIC_OBSTACLE,
                geometry_type=GeometryType.POINT,
                points=[Point2D(x_m=live_object.x_m, y_m=live_object.y_m)],
                label="Live obstacle",
                properties={"radius_m": self.obstacle_inflation_m, "live": True},
            )
            for live_object in obstacle_objects
        )

        health_confidences = [health.confidence for health in sensor_health]
        sensor_confidence = (
            sum(health_confidences) / len(health_confidences) if health_confidences else 0.0
        )
        confidence = min(pose.position_confidence, sensor_confidence)
        any_stale = any(
            health.status in {SensorStatus.STALE, SensorStatus.OFFLINE} for health in sensor_health
        )

        if not sensor_health or confidence < self.confidence_floor or any_stale:
            state = CorridorState.GREY
            reason = "Sensor confidence is too low to verify the corridor"
        elif not self.road.covers(vehicle_point):
            state = CorridorState.RED
            reason = "Vehicle pose is outside the reference road"
        elif nearest_obstacle_m is not None and nearest_obstacle_m <= critical_distance_m:
            state = CorridorState.RED
            reason = "Obstacle blocks the immediate corridor"
        elif nearest_obstacle_m is not None and nearest_obstacle_m <= warning_distance_m:
            state = CorridorState.YELLOW
            reason = "Obstacle reduces available clearance"
        elif confidence < 0.75:
            state = CorridorState.YELLOW
            reason = "Corridor confidence is reduced"
        else:
            state = CorridorState.GREEN
            reason = "Road area is verified at current confidence"

        polygon_points = []
        if selected is not None and not selected.is_empty:
            polygon_points = [Point2D(x_m=x, y_m=y) for x, y in list(selected.exterior.coords)[:-1]]
        return SafeCorridor(
            state=state,
            polygon=polygon_points,
            exclusions=exclusions,
            confidence=confidence,
            reason=reason,
        )
