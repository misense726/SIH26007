from __future__ import annotations

from copy import deepcopy

import pytest

from backend.app.analytics.trip_logger import HaulageAnalyticsEngine
from backend.app.config import project_config
from backend.app.fleet.fleet_manager import FleetManager
from backend.app.fleet.models import HaulCycleState, TripRecord
from backend.app.fleet.vehicle import FleetVehicle
from backend.app.mine_map.graph import MineRoadGraph
from backend.app.mine_map.models import MineEdge, MineNetwork, MineNode, NodeType, RoadStatus
from backend.app.models import SimulationScenario
from backend.app.navigation.models import RouteCostWeights, RouteRequest
from backend.app.navigation.router import RouteOptimizer
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore


def _linear_graph(*, edge_max_weight_tonnes: float = 500.0) -> MineRoadGraph:
    nodes = {
        "A": MineNode(
            node_id="A",
            name="Start",
            x_m=0.0,
            y_m=0.0,
            elevation_m=500.0,
            node_type=NodeType.JUNCTION,
        ),
        "B": MineNode(
            node_id="B",
            name="Middle",
            x_m=0.0,
            y_m=100.0,
            elevation_m=500.0,
            node_type=NodeType.JUNCTION,
        ),
        "C": MineNode(
            node_id="C",
            name="End",
            x_m=0.0,
            y_m=350.0,
            elevation_m=500.0,
            node_type=NodeType.DUMP,
        ),
    }
    edges = {
        "E_AB": MineEdge(
            edge_id="E_AB",
            from_node="A",
            to_node="B",
            distance_m=100.0,
            max_weight_tonnes=edge_max_weight_tonnes,
            is_bidirectional=False,
            segment_name="Start to Middle",
        ),
        "E_BC": MineEdge(
            edge_id="E_BC",
            from_node="B",
            to_node="C",
            distance_m=250.0,
            max_weight_tonnes=edge_max_weight_tonnes,
            is_bidirectional=False,
            segment_name="Middle to End",
        ),
    }
    return MineRoadGraph(
        MineNetwork(
            network_id="TEST_LINEAR_NETWORK",
            name="Deterministic linear test network",
            mine_site="Test site",
            nodes=nodes,
            edges=edges,
        )
    )


def _trip_record(
    *,
    trip_id: str,
    start_time_ms: int,
    end_time_ms: int,
    route_compliance_pct: float = 100.0,
    payload_tonnes: float = 100.0,
) -> TripRecord:
    duration_s = (end_time_ms - start_time_ms) / 1000.0
    return TripRecord(
        trip_id=trip_id,
        vehicle_id="DUMPER_TEST",
        callsign="Controlled Test Dumper",
        pickup_node="A",
        dump_node="C",
        payload_tonnes=payload_tonnes,
        start_time_ms=start_time_ms,
        end_time_ms=end_time_ms,
        cycle_duration_s=duration_s,
        loading_wait_s=duration_s / 6.0,
        loaded_travel_s=duration_s / 3.0,
        dumping_wait_s=duration_s / 12.0,
        empty_return_s=duration_s / 3.0,
        idle_s=duration_s / 12.0,
        distance_km=10.0,
        avg_speed_kmh=10.0,
        route_deviations_count=1,
        route_compliance_pct=route_compliance_pct,
        fuel_litres_est=50.0,
    )


@pytest.fixture
def empty_analytics() -> HaulageAnalyticsEngine:
    return HaulageAnalyticsEngine(seed_baseline=False)


def test_zero_distance_weight_preserves_physical_route_and_instruction_distances() -> None:
    graph = _linear_graph()
    route = RouteOptimizer(graph).find_route(
        RouteRequest(
            start_node_id="A",
            end_node_id="C",
            weights=RouteCostWeights(w1_distance=0.0),
        )
    )

    assert route is not None
    assert route.total_distance_m == 350.0
    assert route.instructions[-1] == "In 250m arrive at End."


def test_route_rejects_gross_weight_above_edge_limit() -> None:
    graph = _linear_graph(edge_max_weight_tonnes=100.0)

    route = RouteOptimizer(graph).find_route(
        RouteRequest(
            start_node_id="A",
            end_node_id="C",
            tare_weight_tonnes=60.0,
            payload_tonnes=50.0,
        )
    )

    assert route is None


def test_fleet_vehicle_node_and_edge_advance_with_route_progress() -> None:
    graph = _linear_graph()
    router = RouteOptimizer(graph)
    route = router.find_route(RouteRequest(start_node_id="A", end_node_id="C"))
    assert route is not None

    vehicle = FleetVehicle(
        vehicle_id="DUMPER_TEST",
        callsign="Controlled Test Dumper",
        initial_node_id="A",
        assigned_pickup="A",
        assigned_dump="C",
        initial_state=HaulCycleState.TRAVELLING_TO_DUMP,
    )
    vehicle.set_position(0.0, 0.0, 500.0, 0.0)
    vehicle.assign_route(route)

    vehicle.step(0.0, 1_000, graph, router)
    vehicle.set_position(0.0, 100.0, 500.0, 0.0)
    vehicle.step(0.0, 1_000, graph, router)

    assert (vehicle.current_node_id, vehicle.current_edge_id) == ("B", "E_BC")


@pytest.mark.asyncio
async def test_full_simulator_pause_freezes_secondary_fleet_poses_and_timers() -> None:
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()), telemetry_hz=10)
    await simulator.apply_control(reset=True, running=False)

    secondary = {
        vehicle_id: vehicle
        for vehicle_id, vehicle in simulator.fleet_manager.vehicles.items()
        if vehicle_id != "DUMPER_01"
    }
    before = {
        vehicle_id: (
            vehicle.x_m,
            vehicle.y_m,
            vehicle.route_waypoint_index,
            vehicle.distance_along_route_m,
            vehicle.state_timer_s,
            vehicle.time_loading_wait_s,
            vehicle.time_loaded_travel_s,
            vehicle.time_dumping_wait_s,
            vehicle.time_empty_return_s,
            vehicle.time_idle_s,
        )
        for vehicle_id, vehicle in secondary.items()
    }

    await simulator.tick()

    after = {
        vehicle_id: (
            vehicle.x_m,
            vehicle.y_m,
            vehicle.route_waypoint_index,
            vehicle.distance_along_route_m,
            vehicle.state_timer_s,
            vehicle.time_loading_wait_s,
            vehicle.time_loaded_travel_s,
            vehicle.time_dumping_wait_s,
            vehicle.time_empty_return_s,
            vehicle.time_idle_s,
        )
        for vehicle_id, vehicle in secondary.items()
    }
    assert after == before


@pytest.mark.asyncio
async def test_full_simulator_reset_restores_closed_road_to_baseline() -> None:
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()), telemetry_hz=10)
    edge_id = "E_STEEP_RAMP_A"

    await simulator.apply_control(
        scenario=SimulationScenario.SCENARIO_5_ROAD_CLOSURE_REROUTE
    )
    closed_edge = simulator.mine_graph.get_edge(edge_id)
    assert closed_edge is not None
    assert closed_edge.road_status is RoadStatus.CLOSED

    await simulator.reset()

    reset_edge = simulator.mine_graph.get_edge(edge_id)
    assert reset_edge is not None
    assert reset_edge.road_status is RoadStatus.OPEN


def test_analytics_route_compliance_comes_from_controlled_records(
    empty_analytics: HaulageAnalyticsEngine,
) -> None:
    empty_analytics.record_trip(
        _trip_record(
            trip_id="TRIP-COMPLIANCE-1",
            start_time_ms=0,
            end_time_ms=3_600_000,
            route_compliance_pct=80.0,
        )
    )
    empty_analytics.record_trip(
        _trip_record(
            trip_id="TRIP-COMPLIANCE-2",
            start_time_ms=3_600_000,
            end_time_ms=7_200_000,
            route_compliance_pct=60.0,
        )
    )

    metrics = empty_analytics.get_haulage_metrics(active_fleet_count=1)

    assert metrics.route_compliance_pct == 70.0


def test_analytics_production_rate_comes_from_controlled_record_span(
    empty_analytics: HaulageAnalyticsEngine,
) -> None:
    empty_analytics.record_trip(
        _trip_record(
            trip_id="TRIP-RATE-1",
            start_time_ms=0,
            end_time_ms=3_600_000,
        )
    )
    empty_analytics.record_trip(
        _trip_record(
            trip_id="TRIP-RATE-2",
            start_time_ms=3_600_000,
            end_time_ms=7_200_000,
        )
    )

    metrics = empty_analytics.get_haulage_metrics(active_fleet_count=1)

    assert metrics.hourly_production_rate_tph == 100.0


def test_collision_warning_prefers_critical_over_lower_severity() -> None:
    fleet = FleetManager(MineRoadGraph())
    primary = fleet.get_vehicle("DUMPER_01")
    critical_target = fleet.get_vehicle("DUMPER_02")
    warning_target = fleet.get_vehicle("DUMPER_03")
    distant_target = fleet.get_vehicle("HAULER_04")
    assert primary is not None
    assert critical_target is not None
    assert warning_target is not None
    assert distant_target is not None

    primary.set_position(0.0, 0.0, 500.0, 0.0)
    primary.speed_mps = 10.0
    critical_target.set_position(10.0, 0.0, 500.0, 0.0)
    critical_target.speed_mps = 10.0
    warning_target.set_position(0.0, 20.0, 500.0, 180.0)
    warning_target.speed_mps = 10.0
    distant_target.set_position(200.0, 200.0, 500.0, 0.0)
    distant_target.speed_mps = 0.0

    fleet.step(0.0, 1_000)

    warning = fleet.get_tactical_collision_warning("DUMPER_01")
    assert warning.threat_level == "CRITICAL"
    assert warning.target_vehicle_id == "DUMPER_02"
