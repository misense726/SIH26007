from __future__ import annotations

import math
import uuid
from typing import Any, Callable, NamedTuple

from backend.app.fleet.models import FleetVehicleSummary, HaulCycleState, TripRecord
from backend.app.fleet.vehicle import FleetVehicle
from backend.app.mine_map.graph import MineRoadGraph
from backend.app.models.operations import RerouteAdvisory
from backend.app.models.telemetry import DataMode, VehiclePose
from backend.app.models.v2x import (
    V2IAdvisoryMessage,
    V2IAdvisoryType,
    V2VBasicSafetyMessage,
    V2XPeerNode,
)
from backend.app.navigation.router import RouteOptimizer
from backend.app.v2x.manager import V2XManager


class TacticalCollisionWarning(NamedTuple):
    target_vehicle_id: str
    target_callsign: str
    distance_m: float
    bearing_deg: float
    direction: str  # "FRONT", "LEFT", "RIGHT", "REAR"
    closing_velocity_mps: float
    threat_level: str  # "SAFE", "CAUTION", "WARNING", "CRITICAL"
    advisory_text: str


class FleetManager:
    """Orchestrates multi-vehicle simulation, V2V BSM mesh, collision warnings, and trip logging."""

    def __init__(
        self,
        mine_graph: MineRoadGraph,
        v2x_manager: V2XManager | None = None,
        on_trip_completed: Callable[[TripRecord], None] | None = None,
    ) -> None:
        self.mine_graph = mine_graph
        self.router = RouteOptimizer(mine_graph)
        self.v2x_manager = v2x_manager or V2XManager()
        self.on_trip_completed = on_trip_completed

        self.vehicles: dict[str, FleetVehicle] = {}
        self.active_collision_warnings: dict[str, TacticalCollisionWarning] = {}
        self.reroute_advisories: list[RerouteAdvisory] = []
        self._initialize_default_fleet()

    def _initialize_default_fleet(self) -> None:
        """Create the standard 4-vehicle NMDC Bailadila fleet."""
        # Vehicle 1 (Primary Instrumented Dumper)
        v1 = FleetVehicle(
            vehicle_id="DUMPER_01",
            callsign="Bailadila Shovel Hauler #01",
            is_primary=True,
            tare_weight_tonnes=85.0,
            target_payload_tonnes=100.0,
            initial_node_id="PICKUP_NORTH_BENCH",
            assigned_pickup="PICKUP_NORTH_BENCH",
            assigned_dump="DUMP_PRIMARY_CRUSHER",
            initial_state=HaulCycleState.WAITING_FOR_LOADING,
            initial_payload_tonnes=0.0,
            color="#38bdf8",
        )
        node_nb = self.mine_graph.get_node("PICKUP_NORTH_BENCH")
        if node_nb:
            v1.set_position(node_nb.x_m, node_nb.y_m, node_nb.elevation_m, 180.0)

        # Vehicle 2 (Mid-haul Loaded Dumper)
        v2 = FleetVehicle(
            vehicle_id="DUMPER_02",
            callsign="Komatsu 930E #02",
            is_primary=False,
            tare_weight_tonnes=85.0,
            target_payload_tonnes=95.0,
            initial_node_id="J_HAUL_04",
            assigned_pickup="PICKUP_NORTH_BENCH",
            assigned_dump="DUMP_PRIMARY_CRUSHER",
            initial_state=HaulCycleState.TRAVELLING_TO_DUMP,
            initial_payload_tonnes=95.0,
            color="#f59e0b",
        )
        node_j4 = self.mine_graph.get_node("J_HAUL_04")
        if node_j4:
            v2.set_position(node_j4.x_m, node_j4.y_m, node_j4.elevation_m, 215.0)

        # Vehicle 3 (East Pit Overburden Hauler)
        v3 = FleetVehicle(
            vehicle_id="DUMPER_03",
            callsign="CAT 793F #03",
            is_primary=False,
            tare_weight_tonnes=85.0,
            target_payload_tonnes=105.0,
            initial_node_id="PICKUP_EAST_PIT",
            assigned_pickup="PICKUP_EAST_PIT",
            assigned_dump="DUMP_WASTE_SOUTH",
            initial_state=HaulCycleState.LOADED,
            initial_payload_tonnes=105.0,
            color="#10b981",
        )
        node_ep = self.mine_graph.get_node("PICKUP_EAST_PIT")
        if node_ep:
            v3.set_position(node_ep.x_m, node_ep.y_m, node_ep.elevation_m, 240.0)

        # Vehicle 4 (Empty Returning Hauler)
        v4 = FleetVehicle(
            vehicle_id="HAULER_04",
            callsign="BEML BH205E #04",
            is_primary=False,
            tare_weight_tonnes=85.0,
            target_payload_tonnes=90.0,
            initial_node_id="DUMP_PRIMARY_CRUSHER",
            assigned_pickup="PICKUP_NORTH_BENCH",
            assigned_dump="DUMP_PRIMARY_CRUSHER",
            initial_state=HaulCycleState.RETURNING_EMPTY,
            initial_payload_tonnes=0.0,
            color="#a855f7",
        )
        node_cr = self.mine_graph.get_node("DUMP_PRIMARY_CRUSHER")
        if node_cr:
            v4.set_position(node_cr.x_m, node_cr.y_m, node_cr.elevation_m, 45.0)

        self.vehicles = {
            v1.vehicle_id: v1,
            v2.vehicle_id: v2,
            v3.vehicle_id: v3,
            v4.vehicle_id: v4,
        }

        # Seed initial routes
        for veh in self.vehicles.values():
            target_node = veh.assigned_dump if veh.payload_tonnes > 0 else veh.assigned_pickup
            veh._plan_route_to(target_node, self.router)

    def reset_fleet(self) -> None:
        self.vehicles.clear()
        self.active_collision_warnings.clear()
        self.reroute_advisories.clear()
        self._initialize_default_fleet()

    def add_reroute_advisory(self, advisory: RerouteAdvisory) -> None:
        self.reroute_advisories.append(advisory)
        if len(self.reroute_advisories) > 20:
            self.reroute_advisories.pop(0)

    def get_vehicle(self, vehicle_id: str) -> FleetVehicle | None:
        return self.vehicles.get(vehicle_id)

    def get_all_summaries(self) -> list[FleetVehicleSummary]:
        return [v.to_summary() for v in self.vehicles.values()]

    def get_all_poses(self, timestamp_ms: int, mode: DataMode = DataMode.SIMULATED) -> list[VehiclePose]:
        return [v.to_vehicle_pose(timestamp_ms, mode) for v in self.vehicles.values()]

    def get_tactical_collision_warning(self, vehicle_id: str = "DUMPER_01") -> TacticalCollisionWarning:
        """Get the highest threat tactical collision warning for the vehicle."""
        if vehicle_id in self.active_collision_warnings:
            return self.active_collision_warnings[vehicle_id]

        return TacticalCollisionWarning(
            target_vehicle_id="NONE",
            target_callsign="No Hazard Detected",
            distance_m=999.0,
            bearing_deg=0.0,
            direction="AHEAD",
            closing_velocity_mps=0.0,
            threat_level="SAFE",
            advisory_text="Perimeter clear.",
        )

    def step(self, dt_s: float, timestamp_ms: int) -> list[TripRecord]:
        """Step all fleet vehicles, exchange V2V BSMs, check collision threats."""
        completed_trips: list[TripRecord] = []

        # 1. Advance each vehicle
        for veh in self.vehicles.values():
            trip = veh.step(dt_s, timestamp_ms, self.mine_graph, self.router)
            if trip:
                completed_trips.append(trip)
                if self.on_trip_completed:
                    self.on_trip_completed(trip)

        # 2. V2V Mesh Broadcast & Tracking
        self._exchange_v2v_bsms(timestamp_ms)

        # 3. Collision Threat Analysis
        self._evaluate_collision_threats()

        return completed_trips

    def _exchange_v2v_bsms(self, timestamp_ms: int) -> None:
        """Transmit V2V Basic Safety Messages between all active dumpers over simulated radio mesh."""
        # 1. Every active vehicle generates its own BSM
        bsm_map: dict[str, V2VBasicSafetyMessage] = {}
        for veh in self.vehicles.values():
            bsm = V2VBasicSafetyMessage(
                message_id=f"BSM-{veh.vehicle_id}-{timestamp_ms}",
                timestamp_ms=timestamp_ms,
                vehicle_id=veh.vehicle_id,
                x_m=round(veh.x_m, 2),
                y_m=round(veh.y_m, 2),
                heading_deg=round(veh.heading_deg % 360.0, 1),
                speed_mps=round(max(0.0, veh.speed_mps), 2),
                emergency_state=veh.emergency_state,
                corridor_state="GREEN",
                brake_applied=veh.speed_mps < 0.5,
            )
            bsm_map[veh.vehicle_id] = bsm

        # 2. Distribute BSMs to every other vehicle within communication range (P2P mesh)
        for v_a in self.vehicles.values():
            for v_b_id, bsm in bsm_map.items():
                if v_b_id == v_a.vehicle_id:
                    continue
                dist = math.hypot(bsm.x_m - v_a.x_m, bsm.y_m - v_a.y_m)
                if dist <= 250.0:
                    v_a.received_bsms[v_b_id] = bsm

        # 3. Synchronize non-primary BSMs into the primary v2x_manager
        primary_veh = self.vehicles.get("DUMPER_01")
        if primary_veh:
            for v_id, bsm in bsm_map.items():
                if v_id != "DUMPER_01":
                    self.v2x_manager.receive_bsm(bsm)

    def _evaluate_collision_threats(self) -> None:
        """Detect closing hazards and directional threat levels for driver HUD using received V2V BSMs."""
        self.active_collision_warnings.clear()

        for v_a in self.vehicles.values():
            highest_threat: TacticalCollisionWarning | None = None
            min_ttc = float("inf")

            # Evaluate threat against all peers from which v_a has received BSMs
            for peer_id, bsm in v_a.received_bsms.items():
                dx = bsm.x_m - v_a.x_m
                dy = bsm.y_m - v_a.y_m
                dist = math.hypot(dx, dy)
                if dist < 0.001:
                    continue

                # Relative velocity along line of sight (closing speed)
                rad_a = math.radians(v_a.heading_deg)
                rad_b = math.radians(bsm.heading_deg)
                vx_a = math.sin(rad_a) * v_a.speed_mps
                vy_a = math.cos(rad_a) * v_a.speed_mps
                vx_b = math.sin(rad_b) * bsm.speed_mps
                vy_b = math.cos(rad_b) * bsm.speed_mps

                rel_vx = vx_b - vx_a
                rel_vy = vy_b - vy_a

                # Unit vector from a to b
                ux = dx / dist
                uy = dy / dist

                # Closing velocity = projection of relative velocity towards each other
                closing_vel = -(rel_vx * ux + rel_vy * uy)

                # Bearing relative to v_a heading
                abs_bearing = (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0
                rel_bearing = (abs_bearing - v_a.heading_deg + 360.0) % 360.0

                # Direction classification
                if rel_bearing <= 45.0 or rel_bearing >= 315.0:
                    direction = "FRONT"
                elif 45.0 < rel_bearing <= 135.0:
                    direction = "RIGHT"
                elif 135.0 < rel_bearing <= 225.0:
                    direction = "REAR"
                else:
                    direction = "LEFT"

                # Threat level evaluation
                threat_level = "SAFE"
                advisory_text = "Clear"
                v_b = self.vehicles.get(peer_id)
                callsign = v_b.callsign if v_b else peer_id

                if dist < 12.0:
                    threat_level = "CRITICAL"
                    advisory_text = f"CRITICAL: Immediate collision risk with {callsign} ({dist:.1f}m)!"
                elif dist < 24.0 and closing_vel > 0.3:
                    threat_level = "WARNING"
                    advisory_text = f"WARNING: {callsign} approaching {direction} at {closing_vel:.1f} m/s ({dist:.1f}m)."
                elif dist < 40.0 and closing_vel > 0.5:
                    threat_level = "CAUTION"
                    advisory_text = f"CAUTION: Vehicle ahead {callsign} closing ({dist:.1f}m)."

                # Time to collision
                ttc = dist / closing_vel if closing_vel > 0.1 else 999.0

                severity_rank = {"CRITICAL": 4, "WARNING": 3, "CAUTION": 2, "SAFE": 1}
                current_rank = severity_rank.get(threat_level, 0)
                highest_rank = severity_rank.get(highest_threat.threat_level, 0) if highest_threat else 0

                is_higher_threat = False
                if threat_level != "SAFE":
                    if highest_threat is None or current_rank > highest_rank:
                        is_higher_threat = True
                    elif current_rank == highest_rank and (ttc < min_ttc or (ttc == min_ttc and dist < highest_threat.distance_m)):
                        is_higher_threat = True

                if is_higher_threat:
                    min_ttc = ttc
                    highest_threat = TacticalCollisionWarning(
                        target_vehicle_id=peer_id,
                        target_callsign=callsign,
                        distance_m=round(dist, 1),
                        bearing_deg=round(rel_bearing, 0),
                        direction=direction,
                        closing_velocity_mps=round(max(0.0, closing_vel), 1),
                        threat_level=threat_level,
                        advisory_text=advisory_text,
                    )

            if highest_threat:
                self.active_collision_warnings[v_a.vehicle_id] = highest_threat
