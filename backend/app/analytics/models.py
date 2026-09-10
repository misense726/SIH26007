from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from backend.app.fleet.models import TripRecord


class CycleTimeBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    loading_wait_minutes: float
    loaded_travel_minutes: float
    dumping_wait_minutes: float
    empty_return_minutes: float
    idle_minutes: float
    total_cycle_minutes: float
    loading_pct: float
    loaded_travel_pct: float
    dumping_pct: float
    empty_return_pct: float
    idle_pct: float


class HaulageMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_completed_cycles: int
    total_ore_moved_tonnes: float
    avg_cycle_time_minutes: float
    fleet_utilization_pct: float
    total_distance_km: float
    route_compliance_pct: float
    active_fleet_count: int
    cycle_time_breakdown: CycleTimeBreakdown
    ore_moved_by_vehicle: dict[str, float]
    cycles_by_vehicle: dict[str, int]
    hourly_production_rate_tph: float
    recent_delay_events: list[str] = Field(default_factory=list)


class TripHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trips: list[TripRecord]
    total_trips: int
    total_tonnes: float
