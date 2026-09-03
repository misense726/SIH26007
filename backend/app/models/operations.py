from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import Field

from backend.app.models.common import Point2D, TelemetryModel


class NodeType(StrEnum):
    BENCH = "BENCH"
    DUMP = "DUMP"
    JUNCTION = "JUNCTION"
    WAYPOINT = "WAYPOINT"


class RoadStatus(StrEnum):
    OPEN = "OPEN"
    RESTRICTED = "RESTRICTED"
    CLOSED = "CLOSED"


class MineNode(TelemetryModel):
    node_id: str
    name: str
    x_m: float
    y_m: float
    elevation_m: float
    node_type: NodeType
    description: str = ""


class MineEdge(TelemetryModel):
    edge_id: str
    from_node: str
    to_node: str
    distance_m: float = Field(gt=0.0)
    gradient_pct: float = 0.0  # positive = uphill from from_node to to_node
    max_weight_tonnes: float = Field(default=240.0, gt=0.0)
    road_status: RoadStatus = RoadStatus.OPEN
    speed_limit_kmh: float = Field(default=40.0, gt=0.0)
    risk_penalty: float = Field(default=0.0, ge=0.0)
    lanes: int = Field(default=2, ge=1)
    is_bidirectional: bool = True
    surface: str = "compacted_gravel"
    segment_name: str = ""


class MineNetwork(TelemetryModel):
    network_id: str
    name: str
    mine_site: str
    nodes: dict[str, MineNode]
    edges: dict[str, MineEdge]


class HaulCycleState(StrEnum):
    IDLE = "IDLE"
    TRAVELLING_TO_PICKUP = "TRAVELLING_TO_PICKUP"
    WAITING_FOR_LOADING = "WAITING_FOR_LOADING"
    LOADED = "LOADED"
    TRAVELLING_TO_DUMP = "TRAVELLING_TO_DUMP"
    WAITING_FOR_DUMP = "WAITING_FOR_DUMP"
    DUMPING = "DUMPING"
    RETURNING_EMPTY = "RETURNING_EMPTY"
    PAUSED = "PAUSED"
    EMERGENCY = "EMERGENCY"


class RouteCostWeights(TelemetryModel):
    w1_distance: float = Field(default=1.0, ge=0.0)
    w2_travel_time: float = Field(default=1.0, ge=0.0)
    w3_payload_penalty: float = Field(default=10.0, ge=0.0)
    w4_road_condition: float = Field(default=50.0, ge=0.0)
    w5_gradient_penalty: float = Field(default=1.0, ge=0.0)
    w6_traffic_penalty: float = Field(default=0.1, ge=0.0)
    w7_safety_penalty: float = Field(default=0.2, ge=0.0)


class RouteRequest(TelemetryModel):
    start_node_id: str
    end_node_id: str
    payload_tonnes: float = Field(default=0.0, ge=0.0)
    tare_weight_tonnes: float = Field(default=85.0, gt=0.0)
    vehicle_id: str = "DUMPER_01"
    weights: RouteCostWeights = Field(default_factory=RouteCostWeights)


class RouteCostBreakdown(TelemetryModel):
    distance_cost: float
    time_cost: float
    payload_cost: float
    road_condition_cost: float
    gradient_cost: float
    traffic_cost: float
    safety_cost: float
    total_cost: float


class NavigationRoute(TelemetryModel):
    route_id: str
    vehicle_id: str
    start_node_id: str
    end_node_id: str
    payload_tonnes: float
    path_nodes: list[str]
    edge_ids: list[str]
    total_distance_m: float
    estimated_time_s: float
    max_gradient_pct: float
    average_speed_kmh: float
    total_cost: float
    cost_breakdown: RouteCostBreakdown
    waypoints: list[Point2D]
    instructions: list[str] = Field(default_factory=list)


class RerouteAdvisory(TelemetryModel):
    advisory_id: str
    vehicle_id: str
    timestamp_ms: int
    trigger_edge_id: str
    trigger_reason: str
    original_route_id: str
    new_route: NavigationRoute
    alternate_found: bool = True


class VehicleOperationalMetadata(TelemetryModel):
    vehicle_id: str
    callsign: str
    is_primary: bool = False
    is_simulated: bool = True
    cycle_state: HaulCycleState = HaulCycleState.IDLE
    payload_tonnes: float = 0.0
    tare_weight_tonnes: float = 85.0
    total_weight_tonnes: float = 85.0
    elevation_m: float = 550.0
    assigned_pickup: str = ""
    assigned_dump: str = ""
    current_destination: str = ""
    distance_to_destination_m: float = 0.0
    next_instruction: str = "System ready."
    current_edge_id: str | None = None
    emergency_state: str = "SAFE"
    total_trips_completed: int = 0
    total_tonnes_moved: float = 0.0
    target_payload_tonnes: float = 100.0
    color: str = "#38bdf8"


class TacticalGuidance(TelemetryModel):
    vehicle_id: str = "DUMPER_01"
    callsign: str = "Bailadila Shovel Hauler #01"
    current_destination: str = "Primary Crusher #01"
    distance_remaining_m: float = 120.0
    next_instruction: str = "Follow green safe corridor."
    speed_kmh: float = 0.0
    target_vehicle_id: str = "NONE"
    target_callsign: str = "No Hazard"
    hazard_distance_m: float = 999.0
    hazard_direction: str = "FRONT"
    closing_velocity_mps: float = 0.0
    threat_level: str = "SAFE"
    advisory_text: str = "Corridor clear."
    visibility_score: float = 1.0
    visibility_state: str = "GOOD"
    estimated_sight_distance_m: float = 120.0


class HaulageMetricsSummary(TelemetryModel):
    total_completed_cycles: int = 0
    total_ore_moved_tonnes: float = 0.0
    avg_cycle_time_minutes: float = 0.0
    fleet_utilization_pct: float = 0.0
    total_distance_km: float = 0.0
    route_compliance_pct: float | None = None
    active_fleet_count: int = 0
    hourly_production_rate_tph: float = 0.0
    recent_delay_events: list[str] = Field(default_factory=list)


class MineOperationsState(TelemetryModel):
    network: MineNetwork | None = None
    fleet: dict[str, VehicleOperationalMetadata] = Field(default_factory=dict)
    routes: dict[str, NavigationRoute] = Field(default_factory=dict)
    guidance: dict[str, TacticalGuidance] = Field(default_factory=dict)
    reroute_advisories: list[RerouteAdvisory] = Field(default_factory=list)
    analytics_summary: HaulageMetricsSummary = Field(default_factory=HaulageMetricsSummary)
    provenance: str = "SIMULATED_RUNTIME"
    network_version: int = 1
