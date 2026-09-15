from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.common import Point2D
from backend.app.models.operations import HaulCycleState


class VehicleKinematics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_speed_flat_kmh: float = 40.0
    max_speed_loaded_kmh: float = 32.0
    max_speed_uphill_loaded_kmh: float = 18.0
    max_speed_turn_kmh: float = 15.0
    acceleration_mps2: float = 1.2
    service_braking_mps2: float = 2.8
    emergency_braking_mps2: float = 4.8


class TripRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trip_id: str
    vehicle_id: str
    callsign: str
    source: Literal["SIMULATED", "LIVE", "REPLAY"] | None = None
    pickup_node: str
    dump_node: str
    payload_tonnes: float
    start_time_ms: int
    end_time_ms: int
    cycle_duration_s: float
    loading_wait_s: float
    loaded_travel_s: float
    dumping_wait_s: float
    empty_return_s: float
    idle_s: float
    distance_km: float
    avg_speed_kmh: float
    route_deviations_count: int = 0
    route_compliance_pct: float = 100.0
    fuel_litres_est: float = 0.0


class FleetVehicleSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vehicle_id: str
    callsign: str
    is_primary: bool
    is_simulated: bool
    cycle_state: HaulCycleState
    payload_tonnes: float
    tare_weight_tonnes: float
    total_weight_tonnes: float
    x_m: float
    y_m: float
    elevation_m: float
    heading_deg: float
    speed_mps: float
    speed_kmh: float
    emergency_state: str
    current_edge_id: str | None
    assigned_pickup: str
    assigned_dump: str
    total_trips_completed: int
    total_tonnes_moved: float
    current_destination: str
    distance_to_destination_m: float
    next_instruction: str
