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
from backend.app.simulation.mine_terrain import mine_terrain


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
            name="Bailadila sector · Conceptual mine",
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
                    [self.route.points[config["dump_waypoint"]]],
                ),
            ],
        )
        self.reference_map.features.extend(mine_terrain(road.interiors))
        for index, ring in enumerate(road.interiors):
            self.reference_map.features.append(
                feature(
                    f"inner-berm-{index}",
                    MapFeatureType.BERM,
                    GeometryType.POLYLINE,
                    "Pit edge berm",
                    [Point2D(x_m=x, y_m=y) for x, y in ring.coords],
                )
            )
        self.dump_distance = sum(self.route.segment_lengths[: config["dump_waypoint"]])
        lead_start = self.route.sample(config["lead_distance_m"])
        self.lead_route = PolylineRoute(
            [
                Point2D(x_m=lead_start.x_m, y_m=lead_start.y_m),
                *[Point2D(x_m=x, y_m=y) for x, y in config["lead_branch_points_m"]],
            ]
        )
        branch = LineString([(p.x_m, p.y_m) for p in self.lead_route.points]).buffer(
            1.5
        )
        self.reference_map.features.append(
            feature(
                "service-road",
                MapFeatureType.ROAD,
                GeometryType.POLYGON,
                "Service road",
                [Point2D(x_m=x, y_m=y) for x, y in branch.exterior.coords[:-1]],
            )
        )
        self.reference_map.features.append(
            feature(
                "service-yard",
                MapFeatureType.TERRAIN,
                GeometryType.POINT,
                "Service yard",
                [self.lead_route.points[-1]],
                cartography="building",
            )
        )
        self.elapsed_s = 0.0
        self.obstacle_detected = False
        self.detected_range = None
        self.traffic_slowing = False
        self.peer_distance = float(config["peer_start_distance_m"])
        self.peer_speed = float(config["peer_speed_mps"])
        self.primary_speed = 0.0
        self.cycle = 1
        self.unloaded = False
        self.dwell_s = 0.0
        self.lead_progress = 0.0
        self.lead_wait_s = 0.0
        self.lead_waiting = False
        self.last_distance = 0.0

    def speed_limit(self, distance: float, requested: float, dt: float) -> float:
        self.last_distance = distance
        primary, peer = self.route.sample(distance), self.peer(0, True)
        separation = math.hypot(primary.x_m - peer.x_m, primary.y_m - peer.y_m)
        self.traffic_slowing = separation < self.config["traffic_slow_distance_m"]
        factor = self.config["traffic_speed_scale"] if self.traffic_slowing else 1.0
        step = self.config["acceleration_mps2"] * dt
        target = requested * factor
        if self.obstacle_detected:
            target = min(target, requested * 0.45)
        lead_gap = self.config["lead_distance_m"] - distance
        self.lead_waiting = 0 < lead_gap < 8 and self.lead_progress < 3
        if self.lead_waiting:
            self.lead_wait_s += dt
            target = min(target, max(0, (lead_gap - 3) * 0.3))
        if self.lead_wait_s >= self.config["lead_yield_s"]:
            self.lead_progress = min(
                self.lead_route.total_length_m,
                self.lead_progress + self.config["lead_speed_mps"] * dt,
            )
        destination = self.route.total_length_m if self.unloaded else self.dump_distance
        if destination - distance < 0.01:
            self.dwell_s += dt
            target = 0.0
            if self.dwell_s >= self.config["site_dwell_s"] and not self.unloaded:
                self.unloaded = True
                self.dwell_s = 0.0
        self.primary_speed += max(-step, min(step, target - self.primary_speed))
        peer_target = self.config["peer_speed_mps"] * factor
        self.peer_speed += max(-step, min(step, peer_target - self.peer_speed))
        self.peer_distance = (
            self.peer_distance - self.peer_speed * dt
        ) % self.route.total_length_m
        return min(self.primary_speed, max(0.0, destination - distance) / dt)

    def next_cycle(self) -> None:
        self.cycle += 1
        self.unloaded = False
        self.dwell_s = 0.0
        self.elapsed_s = 0.0
        self.obstacle_detected = False
        self.detected_range = None
        self.lead_progress = 0.0
        self.lead_wait_s = 0.0
        self.lead_waiting = False

    def observe(self, readings, targets) -> None:
        hits = [
            r.range_m
            for r in readings
            if r.sensor_id in {"front_scanner", "front_fixed"}
            and r.is_valid
            and r.quality >= 0.7
            and targets.get(r.sensor_id) == "simulated-live-obstacle"
        ]
        if hits:
            self.obstacle_detected = True
            self.detected_range = min(hits)
        if (
            self.last_distance
            > self.config["obstacle_distance_m"] + self.config["rock_detour_span_m"]
        ):
            self.obstacle_detected = False
            self.detected_range = None

    def offset(self, distance: float) -> float:
        if not self.obstacle_detected:
            return 0.0
        gap = abs(distance - self.config["obstacle_distance_m"])
        span = self.config["rock_detour_span_m"]
        return (
            self.config["rock_detour_offset_m"]
            * (1 + math.cos(math.pi * min(1, gap / span)))
            / 2
        )

    def lead(self, timestamp_ms: int, running: bool) -> VehiclePose:
        p = self.lead_route.sample(self.lead_progress)
        return VehiclePose(
            vehicle_id="DUMPER_03",
            timestamp_ms=timestamp_ms,
            x_m=p.x_m,
            y_m=p.y_m,
            heading_deg=(
                self.route.sample(self.config["lead_distance_m"]).heading_deg
                if self.lead_progress == 0
                else p.heading_deg
            ),
            speed_mps=self.config["lead_speed_mps"]
            if running
            and self.lead_wait_s >= self.config["lead_yield_s"]
            and self.lead_progress < self.lead_route.total_length_m
            else 0,
            position_confidence=1.0,
        )

    def advance(self, dt: float, running: bool) -> bool:
        if running:
            self.elapsed_s += dt
        return self.elapsed_s >= self.config["obstacle_appears_s"]

    def obstacle_position(self) -> Point2D:
        point = self.route.sample(self.config["obstacle_distance_m"])
        return Point2D(x_m=point.x_m, y_m=point.y_m)

    def peer(self, timestamp_ms: int, running: bool) -> VehiclePose:
        speed = self.peer_speed
        distance = self.peer_distance
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

    def snapshot(
        self, distance: float, enabled: bool, stopped: bool, speed: float = 0.0
    ) -> HaulRouteState:
        destination = self.route.total_length_m if self.unloaded else self.dump_distance
        origin_distance = self.dump_distance if self.unloaded else 0.0
        remaining = max(0.0, destination - distance)
        phase = (
            "ARRIVED"
            if remaining < 0.01 and speed < 0.01
            else "WAITING"
            if stopped and self.obstacle_detected
            else "OBSTACLE"
            if self.obstacle_detected
            else "HAULING"
        )
        instruction = (
            ("Loading at mine site" if self.unloaded else "Unloading at crusher")
            if phase == "ARRIVED"
            else (
                "Rock ahead. Stop"
                if stopped and self.obstacle_detected
                else (
                    "Rock passed. Rejoining track"
                    if distance > self.config["obstacle_distance_m"]
                    else "Rock ahead. Passing left slowly"
                )
                if self.obstacle_detected
                else "Oncoming truck. Passing slowly"
                if self.traffic_slowing
                else "Truck ahead. Waiting for it to turn"
                if self.lead_waiting
                else "Return to the mine loading bay"
                if self.unloaded
                else "Continue on the haul road"
            )
        )
        return HaulRouteState(
            origin="Dump point" if self.unloaded else "Mine loading bay",
            destination="Mine loading bay" if self.unloaded else "Dump point",
            cycle=self.cycle,
            obstacle_detected=self.obstacle_detected,
            obstacle_distance_m=self.detected_range,
            traffic_slowing=self.traffic_slowing,
            lead_waiting=self.lead_waiting,
            planned_path=[
                Point2D(
                    x_m=self.route.sample(d).x_m
                    + math.cos(math.radians(self.route.sample(d).heading_deg))
                    * self.offset(d),
                    y_m=self.route.sample(d).y_m
                    - math.sin(math.radians(self.route.sample(d).heading_deg))
                    * self.offset(d),
                )
                for d in [
                    min(self.route.total_length_m, distance + i * 0.5)
                    for i in range(21)
                ]
            ],
            phase=phase,
            distance_m=max(0.0, distance - origin_distance),
            total_distance_m=destination - origin_distance,
            remaining_m=remaining,
            elapsed_s=self.elapsed_s,
            obstacle=self.obstacle_position() if enabled else None,
            obstacle_radius_m=self.config["obstacle_radius_m"],
            next_instruction=instruction,
        )
