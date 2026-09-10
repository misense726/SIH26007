from __future__ import annotations

import math
import uuid
from typing import Callable

from backend.app.fleet.models import (
    FleetVehicleSummary,
    HaulCycleState,
    TripRecord,
    VehicleKinematics,
)
from backend.app.mine_map.graph import MineRoadGraph
from backend.app.models.common import Point2D
from backend.app.models.operations import VehicleOperationalMetadata
from backend.app.models.telemetry import DataMode, VehiclePose
from backend.app.models.v2x import V2VBasicSafetyMessage
from backend.app.navigation.models import NavigationRoute, RouteRequest
from backend.app.navigation.router import RouteOptimizer


class FleetVehicle:
    """Individual mine haul dumper with kinematics, route following, and cycle state machine."""

    def __init__(
        self,
        vehicle_id: str,
        callsign: str,
        *,
        is_primary: bool = False,
        tare_weight_tonnes: float = 85.0,
        target_payload_tonnes: float = 100.0,
        initial_node_id: str = "PICKUP_NORTH_BENCH",
        assigned_pickup: str = "PICKUP_NORTH_BENCH",
        assigned_dump: str = "DUMP_PRIMARY_CRUSHER",
        initial_state: HaulCycleState = HaulCycleState.TRAVELLING_TO_PICKUP,
        initial_payload_tonnes: float = 0.0,
        color: str = "#38bdf8",
    ) -> None:
        self.vehicle_id = vehicle_id
        self.callsign = callsign
        self.is_primary = is_primary
        self.color = color
        self.tare_weight_tonnes = tare_weight_tonnes
        self.target_payload_tonnes = target_payload_tonnes
        self.payload_tonnes = initial_payload_tonnes
        self.cycle_state = initial_state
        self.previous_state: HaulCycleState | None = None

        self.assigned_pickup = assigned_pickup
        self.assigned_dump = assigned_dump

        self.kinematics = VehicleKinematics()

        # Position and motion
        self.x_m = 0.0
        self.y_m = 0.0
        self.elevation_m = 550.0
        self.heading_deg = 0.0
        self.speed_mps = 0.0
        self.target_speed_mps = 0.0
        self.emergency_state = "SAFE"
        self.current_edge_id: str | None = None

        # Route navigation
        self.current_route: NavigationRoute | None = None
        self.route_waypoint_index = 0
        self.distance_along_route_m = 0.0
        self.distance_to_dest_m = 0.0
        self.next_instruction = "System ready."

        # State timers (in simulation seconds)
        self.state_timer_s = 0.0
        self.loading_wait_duration_s = 3.0
        self.dumping_wait_duration_s = 2.0
        self.dump_duration_s = 2.5

        # Current trip tracking metrics
        self.current_trip_id = f"TRIP-{uuid.uuid4().hex[:8].upper()}"
        self.trip_start_ms = 0
        self.time_loading_wait_s = 0.0
        self.time_loaded_travel_s = 0.0
        self.time_dumping_wait_s = 0.0
        self.time_empty_return_s = 0.0
        self.time_idle_s = 0.0
        self.trip_distance_m = 0.0
        self.total_trips_completed = 0
        self.total_tonnes_moved = 0.0

        self.received_bsms: dict[str, V2VBasicSafetyMessage] = {}
        self.last_heading_error_deg = 0.0
        self._initialize_at_node(initial_node_id)

    def _initialize_at_node(self, node_id: str) -> None:
        """Place vehicle at the designated node initially."""
        self.current_node_id = node_id

    def set_position(self, x_m: float, y_m: float, elevation_m: float, heading_deg: float) -> None:
        self.x_m = x_m
        self.y_m = y_m
        self.elevation_m = elevation_m
        self.heading_deg = heading_deg

    def assign_route(self, route: NavigationRoute) -> None:
        self.current_route = route
        self.route_waypoint_index = 0
        self.distance_along_route_m = 0.0
        self.distance_to_dest_m = route.total_distance_m
        if route.path_nodes:
            self.current_node_id = route.path_nodes[0]
        if route.edge_ids:
            self.current_edge_id = route.edge_ids[0]
        if route.instructions:
            self.next_instruction = route.instructions[0]
        self._update_route_progress()

    def trigger_emergency(self, reason: str = "Safety collision hazard") -> None:
        if self.cycle_state != HaulCycleState.EMERGENCY:
            self.previous_state = self.cycle_state
            self.cycle_state = HaulCycleState.EMERGENCY
            self.emergency_state = "CRITICAL"

    def clear_emergency(self) -> None:
        if self.cycle_state == HaulCycleState.EMERGENCY:
            self.cycle_state = self.previous_state or HaulCycleState.TRAVELLING_TO_DUMP
            self.emergency_state = "SAFE"

    def pause(self) -> None:
        if self.cycle_state != HaulCycleState.PAUSED:
            self.previous_state = self.cycle_state
            self.cycle_state = HaulCycleState.PAUSED

    def resume(self) -> None:
        if self.cycle_state == HaulCycleState.PAUSED:
            self.cycle_state = self.previous_state or HaulCycleState.TRAVELLING_TO_PICKUP

    def step(
        self,
        dt_s: float,
        current_time_ms: int,
        mine_graph: MineRoadGraph,
        router: RouteOptimizer,
    ) -> TripRecord | None:
        """Advance vehicle state and kinematics by dt_s. Returns completed TripRecord if cycle ended."""
        if self.cycle_state == HaulCycleState.PAUSED:
            self.speed_mps = 0.0
            return None

        if dt_s <= 0.0:
            self._update_route_progress()
            self.speed_mps = 0.0
            return None

        if self.trip_start_ms == 0:
            self.trip_start_ms = current_time_ms

        if self.cycle_state == HaulCycleState.EMERGENCY:
            # Apply maximum emergency braking
            self.speed_mps = max(0.0, self.speed_mps - self.kinematics.emergency_braking_mps2 * dt_s)
            self.time_idle_s += dt_s
            return None

        completed_trip: TripRecord | None = None

        # State machine processing
        if self.cycle_state == HaulCycleState.IDLE:
            self.time_idle_s += dt_s
            self.speed_mps = 0.0
            # Automatically start cycle towards pickup
            self._plan_route_to(self.assigned_pickup, router)
            self.cycle_state = HaulCycleState.TRAVELLING_TO_PICKUP

        elif self.cycle_state == HaulCycleState.TRAVELLING_TO_PICKUP:
            self.time_empty_return_s += dt_s
            self._follow_route(dt_s, mine_graph)
            if self.distance_to_dest_m < 3.5 or self._is_at_route_end():
                self.speed_mps = 0.0
                self.cycle_state = HaulCycleState.WAITING_FOR_LOADING
                self.state_timer_s = 0.0
                self.next_instruction = "Positioned at shovel. Loading iron ore."

        elif self.cycle_state == HaulCycleState.WAITING_FOR_LOADING:
            self.time_loading_wait_s += dt_s
            self.state_timer_s += dt_s
            self.speed_mps = 0.0
            if self.state_timer_s >= self.loading_wait_duration_s:
                # Loaded!
                self.payload_tonnes = self.target_payload_tonnes
                self.cycle_state = HaulCycleState.LOADED
                self.state_timer_s = 0.0
                self.next_instruction = f"Loaded {self.payload_tonnes:.0f}T ore. Dispatching to crusher."

        elif self.cycle_state == HaulCycleState.LOADED:
            # Plan payload-aware route to dump point (will select gentle bypass!)
            self._plan_route_to(self.assigned_dump, router)
            self.cycle_state = HaulCycleState.TRAVELLING_TO_DUMP

        elif self.cycle_state == HaulCycleState.TRAVELLING_TO_DUMP:
            self.time_loaded_travel_s += dt_s
            self._follow_route(dt_s, mine_graph)
            if self.distance_to_dest_m < 3.5 or self._is_at_route_end():
                self.speed_mps = 0.0
                self.cycle_state = HaulCycleState.WAITING_FOR_DUMP
                self.state_timer_s = 0.0
                self.next_instruction = "Arrived at crusher hopper bin. Waiting clearance."

        elif self.cycle_state == HaulCycleState.WAITING_FOR_DUMP:
            self.time_dumping_wait_s += dt_s
            self.state_timer_s += dt_s
            self.speed_mps = 0.0
            if self.state_timer_s >= self.dumping_wait_duration_s:
                self.cycle_state = HaulCycleState.DUMPING
                self.state_timer_s = 0.0
                self.next_instruction = "Tipping haul bed into primary crusher hopper."

        elif self.cycle_state == HaulCycleState.DUMPING:
            self.time_dumping_wait_s += dt_s
            self.state_timer_s += dt_s
            self.speed_mps = 0.0
            if self.state_timer_s >= self.dump_duration_s:
                # Tipping complete
                ore_dumped = self.payload_tonnes
                self.payload_tonnes = 0.0
                self.total_tonnes_moved += ore_dumped
                self.cycle_state = HaulCycleState.RETURNING_EMPTY
                self.state_timer_s = 0.0
                self.next_instruction = "Empty bed lowered. Returning to extraction bench."
                # Plan return route (will select steep shortcut!)
                self._plan_route_to(self.assigned_pickup, router)

        elif self.cycle_state == HaulCycleState.RETURNING_EMPTY:
            self.time_empty_return_s += dt_s
            self._follow_route(dt_s, mine_graph)
            if self.distance_to_dest_m < 3.5 or self._is_at_route_end():
                # Cycle complete!
                self.total_trips_completed += 1
                completed_trip = self._compile_trip_record(current_time_ms)
                # Reset for next cycle
                self._reset_trip_metrics(current_time_ms)
                self.cycle_state = HaulCycleState.WAITING_FOR_LOADING
                self.state_timer_s = 0.0
                self.next_instruction = "Positioned at shovel. Loading next haul cycle."

        return completed_trip

    def _compile_trip_record(self, current_time_ms: int) -> TripRecord:
        duration_s = max(1.0, (current_time_ms - self.trip_start_ms) / 1000.0)
        dist_km = self.trip_distance_m / 1000.0
        avg_speed = (dist_km / (duration_s / 3600.0)) if duration_s > 0 else 0.0

        return TripRecord(
            trip_id=self.current_trip_id,
            vehicle_id=self.vehicle_id,
            callsign=self.callsign,
            pickup_node=self.assigned_pickup,
            dump_node=self.assigned_dump,
            payload_tonnes=self.target_payload_tonnes,
            start_time_ms=self.trip_start_ms,
            end_time_ms=current_time_ms,
            cycle_duration_s=round(duration_s, 1),
            loading_wait_s=round(self.time_loading_wait_s, 1),
            loaded_travel_s=round(self.time_loaded_travel_s, 1),
            dumping_wait_s=round(self.time_dumping_wait_s, 1),
            empty_return_s=round(self.time_empty_return_s, 1),
            idle_s=round(self.time_idle_s, 1),
            distance_km=round(dist_km, 3),
            avg_speed_kmh=round(avg_speed, 1),
            route_deviations_count=0,
            route_compliance_pct=100.0,
            fuel_litres_est=round(dist_km * 4.2 + (self.target_payload_tonnes * 0.08), 1),
        )

    def _reset_trip_metrics(self, current_time_ms: int) -> None:
        self.current_trip_id = f"TRIP-{uuid.uuid4().hex[:8].upper()}"
        self.trip_start_ms = current_time_ms
        self.time_loading_wait_s = 0.0
        self.time_loaded_travel_s = 0.0
        self.time_dumping_wait_s = 0.0
        self.time_empty_return_s = 0.0
        self.time_idle_s = 0.0
        self.trip_distance_m = 0.0

    def _plan_route_to(self, dest_node_id: str, router: RouteOptimizer) -> None:
        # Determine closest node as start
        start_node_id = self._find_closest_node(router.mine_graph)
        req = RouteRequest(
            start_node_id=start_node_id,
            end_node_id=dest_node_id,
            payload_tonnes=self.payload_tonnes,
            tare_weight_tonnes=self.tare_weight_tonnes,
            vehicle_id=self.vehicle_id,
        )
        route = router.find_route(req)
        if route:
            self.assign_route(route)

    def _find_closest_node(self, mine_graph: MineRoadGraph) -> str:
        best_id = self.assigned_pickup
        min_d = float("inf")
        for nid, node in mine_graph.nodes.items():
            d = math.hypot(node.x_m - self.x_m, node.y_m - self.y_m)
            if d < min_d:
                min_d = d
                best_id = nid
        return best_id

    def _is_at_route_end(self) -> bool:
        if not self.current_route or not self.current_route.waypoints:
            return True
        return self.route_waypoint_index >= len(self.current_route.waypoints) - 1

    def _update_route_progress(self) -> None:
        if not self.current_route or not self.current_route.waypoints:
            return

        waypoints = self.current_route.waypoints
        if self.route_waypoint_index >= len(waypoints):
            return

        target_wp = waypoints[self.route_waypoint_index]
        dx = target_wp.x_m - self.x_m
        dy = target_wp.y_m - self.y_m
        dist_to_wp = math.hypot(dx, dy)

        # If reached waypoint, advance to next
        while dist_to_wp < 2.0 and self.route_waypoint_index < len(waypoints) - 1:
            self.route_waypoint_index += 1
            target_wp = waypoints[self.route_waypoint_index]
            dx = target_wp.x_m - self.x_m
            dy = target_wp.y_m - self.y_m
            dist_to_wp = math.hypot(dx, dy)

        if self.current_route.path_nodes:
            if self._is_at_route_end() and dist_to_wp < 2.0:
                self.current_node_id = self.current_route.path_nodes[-1]
            elif self.route_waypoint_index > 0:
                node_idx = min(self.route_waypoint_index - 1, len(self.current_route.path_nodes) - 1)
                self.current_node_id = self.current_route.path_nodes[node_idx]
            else:
                self.current_node_id = self.current_route.path_nodes[0]

        if self.current_route.edge_ids:
            if self.route_waypoint_index > 0:
                edge_idx = min(self.route_waypoint_index - 1, len(self.current_route.edge_ids) - 1)
                self.current_edge_id = self.current_route.edge_ids[edge_idx]
            else:
                self.current_edge_id = self.current_route.edge_ids[0]

        # Update remaining distance to route destination
        remaining_m = dist_to_wp
        for i in range(self.route_waypoint_index, len(waypoints) - 1):
            w1 = waypoints[i]
            w2 = waypoints[i + 1]
            remaining_m += math.hypot(w2.x_m - w1.x_m, w2.y_m - w1.y_m)
        self.distance_to_dest_m = remaining_m

    def _follow_route(self, dt_s: float, mine_graph: MineRoadGraph) -> None:
        """Advance kinematics along active route waypoints."""
        if not self.current_route or not self.current_route.waypoints:
            self.speed_mps = 0.0
            return

        waypoints = self.current_route.waypoints
        if self.route_waypoint_index >= len(waypoints):
            self.speed_mps = 0.0
            return

        self._update_route_progress()

        target_wp = waypoints[self.route_waypoint_index]
        dx = target_wp.x_m - self.x_m
        dy = target_wp.y_m - self.y_m

        # Target heading towards current waypoint
        target_heading = (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0
        heading_diff = (target_heading - self.heading_deg + 180.0) % 360.0 - 180.0

        # Rotate heading smoothly
        turn_rate_dps = 45.0  # max steering rate in deg/s
        max_turn = turn_rate_dps * dt_s
        if abs(heading_diff) <= max_turn:
            self.heading_deg = target_heading
        else:
            self.heading_deg = (self.heading_deg + math.copysign(max_turn, heading_diff)) % 360.0

        # Speed regulation based on gradient, payload, and turns
        current_gradient = 0.0
        edge_speed_limit_kmh = 40.0
        if self.current_edge_id:
            e = mine_graph.get_edge(self.current_edge_id)
            if e:
                current_gradient = e.gradient_pct
                edge_speed_limit_kmh = e.speed_limit_kmh

        # Top speed calculations
        if self.payload_tonnes > 50.0:
            if current_gradient > 5.0:
                top_speed_kmh = self.kinematics.max_speed_uphill_loaded_kmh
            else:
                top_speed_kmh = self.kinematics.max_speed_loaded_kmh
        else:
            top_speed_kmh = self.kinematics.max_speed_flat_kmh

        # Enforce road segment speed limit
        top_speed_kmh = min(top_speed_kmh, edge_speed_limit_kmh)

        # Turn slowing
        if abs(heading_diff) > 25.0:
            top_speed_kmh = min(top_speed_kmh, self.kinematics.max_speed_turn_kmh)

        # Deceleration when nearing final destination
        if self.distance_to_dest_m < 8.0:
            top_speed_kmh = min(top_speed_kmh, 10.0)

        target_mps = top_speed_kmh / 3.6
        self.target_speed_mps = target_mps

        # Accelerate or brake towards target speed
        if self.speed_mps < target_mps:
            self.speed_mps = min(target_mps, self.speed_mps + self.kinematics.acceleration_mps2 * dt_s)
        else:
            self.speed_mps = max(target_mps, self.speed_mps - self.kinematics.service_braking_mps2 * dt_s)

        # Move forward
        step_dist = self.speed_mps * dt_s
        rad = math.radians(self.heading_deg)
        self.x_m += math.sin(rad) * step_dist
        self.y_m += math.cos(rad) * step_dist
        self.trip_distance_m += step_dist
        self.distance_along_route_m += step_dist

        # Elevation interpolation
        dest_node = mine_graph.get_node(self.current_route.end_node_id)
        if dest_node:
            alpha = min(1.0, self.distance_along_route_m / max(1.0, self.current_route.total_distance_m))
            start_node = mine_graph.get_node(self.current_route.start_node_id)
            start_elev = start_node.elevation_m if start_node else 550.0
            self.elevation_m = round(start_elev + alpha * (dest_node.elevation_m - start_elev), 1)

        # Update next instruction from route
        if self.current_route.instructions and self.route_waypoint_index < len(self.current_route.instructions):
            self.next_instruction = self.current_route.instructions[self.route_waypoint_index]

    def to_vehicle_pose(self, timestamp_ms: int, mode: DataMode = DataMode.SIMULATED) -> VehiclePose:
        heading = round(self.heading_deg % 360.0, 1)
        if heading >= 360.0 or heading < 0.0:
            heading = 0.0
        return VehiclePose(
            timestamp_ms=timestamp_ms,
            vehicle_id=self.vehicle_id,
            x_m=round(self.x_m, 2),
            y_m=round(self.y_m, 2),
            heading_deg=heading,
            speed_mps=round(self.speed_mps, 2),
            position_confidence=1.0,
            mode=mode,
        )

    def to_summary(self) -> FleetVehicleSummary:
        dest_name = (
            self.assigned_dump
            if self.cycle_state in {HaulCycleState.LOADED, HaulCycleState.TRAVELLING_TO_DUMP, HaulCycleState.WAITING_FOR_DUMP, HaulCycleState.DUMPING}
            else self.assigned_pickup
        )
        return FleetVehicleSummary(
            vehicle_id=self.vehicle_id,
            callsign=self.callsign,
            is_primary=self.is_primary,
            is_simulated=True,
            cycle_state=self.cycle_state,
            payload_tonnes=round(self.payload_tonnes, 1),
            tare_weight_tonnes=self.tare_weight_tonnes,
            total_weight_tonnes=round(self.tare_weight_tonnes + self.payload_tonnes, 1),
            x_m=round(self.x_m, 2),
            y_m=round(self.y_m, 2),
            elevation_m=round(self.elevation_m, 1),
            heading_deg=round(self.heading_deg, 1),
            speed_mps=round(self.speed_mps, 2),
            speed_kmh=round(self.speed_mps * 3.6, 1),
            emergency_state=self.emergency_state,
            current_edge_id=self.current_edge_id,
            assigned_pickup=self.assigned_pickup,
            assigned_dump=self.assigned_dump,
            total_trips_completed=self.total_trips_completed,
            total_tonnes_moved=round(self.total_tonnes_moved, 1),
            current_destination=dest_name,
            distance_to_destination_m=round(self.distance_to_dest_m, 1),
            next_instruction=self.next_instruction,
        )

    def to_operational_metadata(self) -> VehicleOperationalMetadata:
        dest_name = (
            self.assigned_dump
            if self.cycle_state in {HaulCycleState.LOADED, HaulCycleState.TRAVELLING_TO_DUMP, HaulCycleState.WAITING_FOR_DUMP, HaulCycleState.DUMPING}
            else self.assigned_pickup
        )
        return VehicleOperationalMetadata(
            vehicle_id=self.vehicle_id,
            callsign=self.callsign,
            is_primary=self.is_primary,
            is_simulated=True,
            cycle_state=self.cycle_state,
            payload_tonnes=round(self.payload_tonnes, 1),
            tare_weight_tonnes=self.tare_weight_tonnes,
            total_weight_tonnes=round(self.tare_weight_tonnes + self.payload_tonnes, 1),
            elevation_m=round(self.elevation_m, 1),
            assigned_pickup=self.assigned_pickup,
            assigned_dump=self.assigned_dump,
            current_destination=dest_name,
            distance_to_destination_m=round(self.distance_to_dest_m, 1),
            next_instruction=self.next_instruction,
            current_edge_id=self.current_edge_id,
            emergency_state=self.emergency_state,
            total_trips_completed=self.total_trips_completed,
            total_tonnes_moved=round(self.total_tonnes_moved, 1),
            target_payload_tonnes=self.target_payload_tonnes,
            color=self.color,
        )
