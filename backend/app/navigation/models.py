from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.telemetry import Point2D


class RouteCostWeights(BaseModel):
    model_config = ConfigDict(extra="forbid")

    w1_distance: float = Field(default=1.0, ge=0.0)
    w2_travel_time: float = Field(default=1.0, ge=0.0)
    w3_payload_penalty: float = Field(default=10.0, ge=0.0)
    w4_road_condition: float = Field(default=50.0, ge=0.0)
    w5_gradient_penalty: float = Field(default=1.0, ge=0.0)
    w6_traffic_penalty: float = Field(default=0.1, ge=0.0)
    w7_safety_penalty: float = Field(default=0.2, ge=0.0)


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_node_id: str
    end_node_id: str
    payload_tonnes: float = Field(default=0.0, ge=0.0)
    tare_weight_tonnes: float = Field(default=85.0, gt=0.0)
    vehicle_id: str = "DUMPER_01"
    weights: RouteCostWeights = Field(default_factory=RouteCostWeights)


class RouteCostBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    distance_cost: float
    time_cost: float
    payload_cost: float
    road_condition_cost: float
    gradient_cost: float
    traffic_cost: float
    safety_cost: float
    total_cost: float


class NavigationRoute(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


class RerouteAdvisory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    advisory_id: str
    vehicle_id: str
    timestamp_ms: int
    trigger_edge_id: str
    trigger_reason: str
    original_route_id: str
    new_route: NavigationRoute
    alternate_found: bool = True
