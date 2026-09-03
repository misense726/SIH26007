from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.analytics.trip_logger import HaulageAnalyticsEngine
from backend.app.fleet.fleet_manager import FleetManager
from backend.app.fleet.models import HaulCycleState, TripRecord
from backend.app.fleet.vehicle import FleetVehicle
from backend.app.main import create_app
from backend.app.mine_map.graph import MineRoadGraph
from backend.app.navigation.router import RouteOptimizer


def test_vehicle_cycle_state_transitions() -> None:
    graph = MineRoadGraph()
    router = RouteOptimizer(graph)
    veh = FleetVehicle(
        vehicle_id="TEST_TRUCK_01",
        callsign="Test Shovel Hauler",
        tare_weight_tonnes=85.0,
        target_payload_tonnes=100.0,
        initial_node_id="PICKUP_NORTH_BENCH",
        assigned_pickup="PICKUP_NORTH_BENCH",
        assigned_dump="DUMP_PRIMARY_CRUSHER",
        initial_state=HaulCycleState.WAITING_FOR_LOADING,
        initial_payload_tonnes=0.0,
    )
    veh.loading_wait_duration_s = 0.2
    veh.dumping_wait_duration_s = 0.2
    veh.dump_duration_s = 0.2

    # Step in WAITING_FOR_LOADING
    veh.step(0.3, 1000, graph, router)
    assert veh.cycle_state == HaulCycleState.LOADED
    assert veh.payload_tonnes == 100.0

    # Step in LOADED -> TRAVELLING_TO_DUMP
    veh.step(0.1, 1100, graph, router)
    assert veh.cycle_state == HaulCycleState.TRAVELLING_TO_DUMP
    assert veh.current_route is not None


def test_fleet_manager_and_collision_warning() -> None:
    graph = MineRoadGraph()
    fleet = FleetManager(graph)

    # All 4 dumpers initialized
    assert len(fleet.vehicles) == 4
    assert "DUMPER_01" in fleet.vehicles
    assert "DUMPER_02" in fleet.vehicles
    assert "DUMPER_03" in fleet.vehicles
    assert "HAULER_04" in fleet.vehicles

    # Position DUMPER_01 and DUMPER_02 in close proximity facing each other
    v1 = fleet.get_vehicle("DUMPER_01")
    v2 = fleet.get_vehicle("DUMPER_02")
    assert v1 is not None and v2 is not None

    v1.set_position(x_m=10.0, y_m=20.0, elevation_m=580.0, heading_deg=0.0)
    v1.speed_mps = 6.0
    v2.set_position(x_m=10.0, y_m=35.0, elevation_m=580.0, heading_deg=180.0)
    v2.speed_mps = 6.0

    # Step fleet manager
    fleet.step(0.1, 2000)

    # Check collision warning for DUMPER_01
    warning = fleet.get_tactical_collision_warning("DUMPER_01")
    assert warning.target_vehicle_id == "DUMPER_02"
    assert warning.distance_m < 20.0
    assert warning.threat_level in {"WARNING", "CRITICAL"}
    assert warning.closing_velocity_mps > 5.0


def test_haulage_analytics_engine() -> None:
    analytics = HaulageAnalyticsEngine()
    metrics = analytics.get_haulage_metrics(active_fleet_count=4)

    assert metrics.total_completed_cycles > 0
    assert metrics.total_ore_moved_tonnes > 0
    assert metrics.fleet_utilization_pct > 0.0
    assert metrics.cycle_time_breakdown.total_cycle_minutes > 0.0
    assert metrics.cycle_time_breakdown.loading_pct > 0.0
    assert metrics.cycle_time_breakdown.loaded_travel_pct > 0.0

    history = analytics.get_trip_history(limit=10)
    assert len(history.trips) > 0
    assert history.total_trips >= len(history.trips)


def test_analytics_api_endpoints() -> None:
    app = create_app()
    with TestClient(app) as client:
        # Haulage metrics
        res_m = client.get("/api/analytics/haulage-metrics")
        assert res_m.status_code == 200
        m_data = res_m.json()
        assert m_data["total_completed_cycles"] > 0
        assert "cycle_time_breakdown" in m_data

        # Trip history
        res_h = client.get("/api/analytics/trip-history?limit=5")
        assert res_h.status_code == 200
        h_data = res_h.json()
        assert len(h_data["trips"]) == 5

        # Fleet vehicles list
        res_f = client.get("/api/fleet/vehicles")
        assert res_f.status_code == 200
        f_data = res_f.json()
        assert len(f_data) == 4
