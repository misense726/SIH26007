"""Mine route geometry and encounter timing, in local metres and seconds."""

from __future__ import annotations

import math

from shapely.geometry import LineString

from backend.app.models import (
    GeometryType,
    MapFeature,
    MapFeatureType,
    Point2D,
    ReferenceMap,
    VehiclePose,
)
from backend.app.models.telemetry import HaulRouteState
from backend.app.twin.route import PolylineRoute


class HaulRun:
    def __init__(self, config: dict) -> None:
        self.config = config
        self.route = PolylineRoute(
            [Point2D(x_m=x, y_m=y) for x, y in config["route_points_m"]]
        )
        road = LineString([(p.x_m, p.y_m) for p in self.route.points]).buffer(
            config["road_half_width_m"],
            quad_segs=3,
        )
        boundary = [Point2D(x_m=x, y_m=y) for x, y in road.exterior.coords]

        def feature(identifier, kind, geometry, label, points, **properties):
            return MapFeature(
                feature_id=identifier,
                feature_type=kind,
                geometry_type=geometry,
                label=label,
                points=points,
                properties=properties,
            )

        self.reference_map = ReferenceMap(
            map_id="FOGSEN_MINE_HAUL",
            name="Mine to dump haul road",
            created_at_ms=0,
            features=[
                feature(
                    "haul-road",
                    MapFeatureType.ROAD,
                    GeometryType.POLYGON,
                    "Haul road",
                    boundary[:-1],
                ),
                feature(
                    "haul-berm",
                    MapFeatureType.BERM,
                    GeometryType.POLYLINE,
                    "Road berm",
                    boundary,
                ),
                feature(
                    "haul-route",
                    MapFeatureType.ROUTE,
                    GeometryType.POLYLINE,
                    "Mine to dump",
                    list(self.route.points),
                ),
                feature(
                    "haul-center",
                    MapFeatureType.CENTERLINE,
                    GeometryType.POLYLINE,
                    "Road centre",
                    list(self.route.points),
                ),
                feature(
                    "mine",
                    MapFeatureType.START,
                    GeometryType.POINT,
                    "Mine loading bay",
                    [self.route.points[0]],
                ),
                feature(
                    "dump",
                    MapFeatureType.DESTINATION,
                    GeometryType.POINT,
                    "Dump point",
                    [self.route.points[-1]],
                ),
            ],
        )
        self.elapsed_s = 0.0
        self.stopped_s = 0.0
        self.obstacle_cleared = False

    def advance(self, dt: float, running: bool, stopped: bool) -> bool:
        if running:
            self.elapsed_s += dt
            if stopped:
                self.stopped_s += dt
        if self.stopped_s >= self.config["obstacle_hold_s"]:
            self.obstacle_cleared = True
        return (
            self.elapsed_s >= self.config["obstacle_appears_s"]
            and not self.obstacle_cleared
        )

    def obstacle_position(self) -> Point2D:
        point = self.route.sample(self.config["obstacle_distance_m"])
        return Point2D(x_m=point.x_m, y_m=point.y_m)

    def peer(self, timestamp_ms: int, running: bool) -> VehiclePose:
        speed = self.config["peer_speed_mps"]
        distance = max(
            0.0, self.config["peer_start_distance_m"] - self.elapsed_s * speed
        )
        point = self.route.sample(distance)
        heading = math.radians(point.heading_deg)
        lane = self.config["peer_lane_offset_m"]
        return VehiclePose(
            vehicle_id="DUMPER_02",
            timestamp_ms=timestamp_ms,
            x_m=point.x_m + math.cos(heading) * lane,
            y_m=point.y_m - math.sin(heading) * lane,
            heading_deg=(point.heading_deg + 180) % 360,
            speed_mps=speed if running and distance > 0 else 0,
            position_confidence=1.0,
        )

    def snapshot(self, distance: float, enabled: bool, stopped: bool) -> HaulRouteState:
        remaining = max(0.0, self.route.total_length_m - distance)
        phase = (
            "ARRIVED"
            if remaining < 0.01
            else "WAITING"
            if stopped
            else "OBSTACLE"
            if enabled
            else "HAULING"
        )
        instruction = (
            "Arrived at dump point"
            if phase == "ARRIVED"
            else (
                "Stopped. Waiting for road clearance"
                if stopped
                else "Obstacle ahead. Prepare to stop"
                if enabled
                else "Follow the right bend to the dump"
                if distance > 29
                else "Continue on the haul road"
            )
        )
        return HaulRouteState(
            phase=phase,
            distance_m=distance,
            total_distance_m=self.route.total_length_m,
            remaining_m=remaining,
            elapsed_s=self.elapsed_s,
            obstacle=self.obstacle_position() if enabled else None,
            obstacle_radius_m=self.config["obstacle_radius_m"],
            next_instruction=instruction,
        )
