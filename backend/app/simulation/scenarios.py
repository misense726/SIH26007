from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

from backend.app.fleet.models import HaulCycleState, TripRecord
from backend.app.mine_map.models import RoadStatus
from backend.app.models.common import Point2D
from backend.app.models.telemetry import SimulationScenario
from backend.app.models.v2x import V2IAdvisoryMessage, V2IAdvisoryType
from backend.app.navigation.models import RouteRequest


@dataclass
class ScenarioDefinition:
    scenario: SimulationScenario
    name: str
    code: str
    description: str
    visibility_score: float
    obstacle_enabled: bool
    obstacle_position: Point2D
    obstacle_radius_m: float = 0.45
    speed_scale: float = 1.0
    setup_fn: Callable[[Any], None] | None = None


def _setup_scenario_1(sim: Any) -> None:
    """Scenario 1: Dense Fog Normal Haulage - Visibility drops to 15%, synthetic overlay active."""
    fleet = sim.fleet_manager
    v2x = sim._v2x_manager
    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
    adv = V2IAdvisoryMessage(
        message_id="ADV-SCEN-01",
        rsu_id="RSU_MINE_PIT_NORTH",
        rsu_name="North Pit Haul RSU-1",
        advisory_type=V2IAdvisoryType.FOG_WARNING,
        title="Dense Fog Warning - Visibility 15%",
        detail="Extreme fog on main haul ramps. Synthetic radar/ToF corridor mandatory.",
        speed_limit_kmh=15.0,
        zone_x_m=20.0,
        zone_y_m=45.0,
        zone_radius_m=120.0,
    )
    v2x.broadcast_advisory(adv)


def _setup_scenario_2(sim: Any) -> None:
    """Scenario 2: Vehicle Ahead - Lead truck ahead slowing down; closing speed warning triggered."""
    sim._speed_scale = 2.0
    s1 = sim._route.sample(25.0)
    sim._route_distance_m = 25.0
    sim._scene.pose.x_m = s1.x_m
    sim._scene.pose.y_m = s1.y_m
    sim._scene.pose.heading_deg = s1.heading_deg
    sim._scene.pose.speed_mps = sim._route_speed_mps * sim._speed_scale

    fleet = sim.fleet_manager
    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
        v1.set_position(s1.x_m, s1.y_m, 560.0, s1.heading_deg)
        v1.speed_mps = sim._route_speed_mps * sim._speed_scale
        v1.cycle_state = HaulCycleState.TRAVELLING_TO_DUMP

    s2 = sim._route.sample(47.0)
    v2 = fleet.get_vehicle("DUMPER_02")
    if v2:
        v2.clear_emergency()
        v2.resume()
        v2.set_position(s2.x_m, s2.y_m, 565.0, s2.heading_deg)
        v2.speed_mps = 0.4
        v2.cycle_state = HaulCycleState.TRAVELLING_TO_DUMP


def _setup_scenario_3(sim: Any) -> None:
    """Scenario 3: Opposing Vehicle - Two dumpers approach on narrow single-way haul segment."""
    sim._speed_scale = 1.8
    s1 = sim._route.sample(35.0)
    sim._route_distance_m = 35.0
    sim._scene.pose.x_m = s1.x_m
    sim._scene.pose.y_m = s1.y_m
    sim._scene.pose.heading_deg = s1.heading_deg
    sim._scene.pose.speed_mps = sim._route_speed_mps * sim._speed_scale

    fleet = sim.fleet_manager
    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
        v1.set_position(s1.x_m, s1.y_m, 560.0, s1.heading_deg)
        v1.speed_mps = sim._route_speed_mps * sim._speed_scale
        v1.cycle_state = HaulCycleState.TRAVELLING_TO_DUMP

    s2 = sim._route.sample(58.0)
    v2 = fleet.get_vehicle("DUMPER_02")
    if v2:
        v2.clear_emergency()
        v2.resume()
        opp_heading = (s2.heading_deg + 180.0) % 360.0
        v2.set_position(s2.x_m, s2.y_m, 565.0, opp_heading)
        v2.speed_mps = 2.0
        v2.cycle_state = HaulCycleState.RETURNING_EMPTY


def _setup_scenario_4(sim: Any) -> None:
    """Scenario 4: Static Obstacle - Fallen boulder on haul road detected by range sensing."""
    fleet = sim.fleet_manager
    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
    pose = sim._route.sample(sim._route_distance_m)
    rad = math.radians(pose.heading_deg)
    sim._obstacle_position = Point2D(
        x_m=round(pose.x_m + math.sin(rad) * 1.5, 2),
        y_m=round(pose.y_m + math.cos(rad) * 1.5, 2),
    )
    sim._obstacle_enabled = True
    sim._active_obstacle_radius_m = 0.6


def _setup_scenario_5(sim: Any) -> None:
    """Scenario 5: Road Closure & Automatic Reroute - V2I closes haul segment; vehicle reroutes."""
    graph = sim.mine_graph
    fleet = sim.fleet_manager
    v2x = sim._v2x_manager

    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
        v1.set_position(15.0, 105.0, 550.0, 180.0)
        r_init = fleet.router.find_route(RouteRequest(
            start_node_id="PICKUP_NORTH_BENCH",
            end_node_id="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=0.0,
            tare_weight_tonnes=85.0,
            vehicle_id="DUMPER_01",
        ))
        if r_init:
            v1.assign_route(r_init)

    graph.update_edge_status("E_STEEP_RAMP_A", RoadStatus.CLOSED)
    if v1 and v1.current_route:
        advisory = fleet.router.check_dynamic_reroute(
            v1.current_route,
            "E_STEEP_RAMP_A",
            v1.current_node_id,
            reason="Rockfall on E_STEEP_RAMP_A",
        )
        if advisory:
            v1.assign_route(advisory.new_route)
            fleet.add_reroute_advisory(advisory)

    adv = V2IAdvisoryMessage(
        message_id="ADV-SCEN-05",
        rsu_id="RSU_MINE_PIT_NORTH",
        rsu_name="North Pit Haul RSU-1",
        advisory_type=V2IAdvisoryType.ROAD_MAINTENANCE,
        title="Ramp Closure: Steep Incline Closed",
        detail="Boulder clearing in progress on E_STEEP_RAMP_A. Rerouting via Perimeter Bypass.",
        speed_limit_kmh=20.0,
        zone_x_m=10.0,
        zone_y_m=45.0,
        zone_radius_m=50.0,
    )
    v2x.broadcast_advisory(adv)


def _setup_scenario_6(sim: Any) -> None:
    """Scenario 6: Payload-Based Dynamic Routing - Loaded dumper takes flat route vs Empty dumper taking steep shortcut."""
    graph = sim.mine_graph
    fleet = sim.fleet_manager
    graph.update_edge_status("E_STEEP_RAMP_A", RoadStatus.OPEN)
    graph.update_edge_status("E_STEEP_RAMP_B", RoadStatus.OPEN)

    v1 = fleet.get_vehicle("DUMPER_01")
    v2 = fleet.get_vehicle("DUMPER_02")
    if v1 and v2:
        v1.clear_emergency()
        v1.resume()
        v1.set_position(15.0, 105.0, 550.0, 180.0)
        v1.payload_tonnes = 100.0  # Fully Loaded 100T
        v1.cycle_state = HaulCycleState.LOADED
        route_loaded = fleet.router.find_route(RouteRequest(
            start_node_id="PICKUP_NORTH_BENCH",
            end_node_id="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=100.0,
            tare_weight_tonnes=85.0,
            vehicle_id="DUMPER_01",
        ))
        if route_loaded:
            v1.assign_route(route_loaded)

        v2.clear_emergency()
        v2.resume()
        v2.set_position(15.0, 105.0, 550.0, 180.0)
        v2.payload_tonnes = 0.0  # Empty 0T
        v2.cycle_state = HaulCycleState.RETURNING_EMPTY
        route_empty = fleet.router.find_route(RouteRequest(
            start_node_id="PICKUP_NORTH_BENCH",
            end_node_id="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=0.0,
            tare_weight_tonnes=85.0,
            vehicle_id="DUMPER_02",
        ))
        if route_empty:
            v2.assign_route(route_empty)


def _setup_scenario_7(sim: Any) -> None:
    """Scenario 7: Supervisor Multi-Fleet Monitoring - Multiple dumpers running concurrent haulage cycles."""
    for veh in sim.fleet_manager.vehicles.values():
        veh.clear_emergency()
        veh.resume()


def _setup_scenario_8(sim: Any) -> None:
    """Scenario 8: Haulage Analytics - Review of completed trips, cycle times, and operational delays."""
    for veh in sim.fleet_manager.vehicles.values():
        veh.clear_emergency()
        veh.resume()
    sim.analytics.record_trip(
        TripRecord(
            trip_id="TRIP-DEMO-01",
            vehicle_id="DUMPER_01",
            callsign="Bailadila Shovel Hauler #01",
            pickup_node="PICKUP_NORTH_BENCH",
            dump_node="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=100.0,
            start_time_ms=sim._timestamp_ms - 1_200_000,
            end_time_ms=sim._timestamp_ms,
            cycle_duration_s=1200.0,
            loading_wait_s=180.0,
            loaded_travel_s=420.0,
            dumping_wait_s=120.0,
            empty_return_s=360.0,
            idle_s=120.0,
            distance_km=4.8,
            avg_speed_kmh=24.0,
            route_deviations_count=0,
            route_compliance_pct=100.0,
            fuel_litres_est=45.0,
        )
    )


ALL_SCENARIOS: dict[SimulationScenario, ScenarioDefinition] = {
    # Backward compatibility with existing tests
    SimulationScenario.NORMAL: ScenarioDefinition(
        scenario=SimulationScenario.NORMAL,
        name="Normal Haulage",
        code="NORMAL",
        description="Standard clear-weather haulage conditions with full visibility.",
        visibility_score=0.88,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
    ),
    SimulationScenario.FOG: ScenarioDefinition(
        scenario=SimulationScenario.FOG,
        name="Dense Fog",
        code="FOG",
        description="Reduced visibility to 18% with active synthetic spatial guidance.",
        visibility_score=0.18,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
    ),
    SimulationScenario.OBSTACLE: ScenarioDefinition(
        scenario=SimulationScenario.OBSTACLE,
        name="Obstacle Alert",
        code="OBSTACLE",
        description="Hazardous boulder on haul corridor triggering caution warning.",
        visibility_score=0.72,
        obstacle_enabled=True,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
    ),
    SimulationScenario.EMERGENCY: ScenarioDefinition(
        scenario=SimulationScenario.EMERGENCY,
        name="Emergency Stop",
        code="EMERGENCY",
        description="Critical forward proximity violation activating automatic motor cut.",
        visibility_score=0.38,
        obstacle_enabled=True,
        obstacle_position=Point2D(x_m=5.0, y_m=5.0),
    ),

    # The 8 Mandatory NMDC Bailadila Scenarios
    SimulationScenario.SCENARIO_1_DENSE_FOG: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_1_DENSE_FOG,
        name="Scenario 1: Dense Fog Normal Haulage",
        code="S1_FOG",
        description="Visibility drops to 15%. Synthetic digital twin overlay and safe corridor guidance active.",
        visibility_score=0.15,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        setup_fn=_setup_scenario_1,
    ),
    SimulationScenario.SCENARIO_2_VEHICLE_AHEAD: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_2_VEHICLE_AHEAD,
        name="Scenario 2: Vehicle Ahead Closing",
        code="S2_LEAD_VEHICLE",
        description="Lead truck DUMPER_02 slows down ahead in the lane; closing speed collision warning triggered.",
        visibility_score=0.25,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        setup_fn=_setup_scenario_2,
    ),
    SimulationScenario.SCENARIO_3_OPPOSING_VEHICLE: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_3_OPPOSING_VEHICLE,
        name="Scenario 3: Opposing Vehicle on Haul Road",
        code="S3_OPPOSING",
        description="Two dumpers approach each other on a narrow haul segment; V2V collision alert activates.",
        visibility_score=0.20,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        setup_fn=_setup_scenario_3,
    ),
    SimulationScenario.SCENARIO_4_STATIC_OBSTACLE: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_4_STATIC_OBSTACLE,
        name="Scenario 4: Static Boulder on Road",
        code="S4_BOULDER",
        description="Fallen boulder detected by forward ToF range sensing; safe corridor turns RED.",
        visibility_score=0.30,
        obstacle_enabled=True,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        obstacle_radius_m=0.55,
        setup_fn=_setup_scenario_4,
    ),
    SimulationScenario.SCENARIO_5_ROAD_CLOSURE_REROUTE: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_5_ROAD_CLOSURE_REROUTE,
        name="Scenario 5: Road Closure & Automatic Reroute",
        code="S5_REROUTE",
        description="V2I advisory closes steep haul ramp; active vehicle automatically recalculates alternate route.",
        visibility_score=0.50,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        setup_fn=_setup_scenario_5,
    ),
    SimulationScenario.SCENARIO_6_PAYLOAD_ROUTING: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_6_PAYLOAD_ROUTING,
        name="Scenario 6: Payload-Based Dynamic Routing",
        code="S6_PAYLOAD",
        description="Loaded Dumper (100T) takes gentle bypass while Empty Dumper (0T) takes steep shortcut.",
        visibility_score=0.65,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        setup_fn=_setup_scenario_6,
    ),
    SimulationScenario.SCENARIO_7_FLEET_MONITORING: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_7_FLEET_MONITORING,
        name="Scenario 7: Supervisor Multi-Fleet Monitoring",
        code="S7_FLEET",
        description="All 4 dumpers actively navigating concurrent haulage cycles across the Bailadila network.",
        visibility_score=0.40,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        setup_fn=_setup_scenario_7,
    ),
    SimulationScenario.SCENARIO_8_HAULAGE_ANALYTICS: ScenarioDefinition(
        scenario=SimulationScenario.SCENARIO_8_HAULAGE_ANALYTICS,
        name="Scenario 8: Haulage Efficiency Analytics",
        code="S8_ANALYTICS",
        description="Live operational analytics review: tonnes moved, cycle stage breakdown, and fleet utilization.",
        visibility_score=0.75,
        obstacle_enabled=False,
        obstacle_position=Point2D(x_m=7.0, y_m=7.4),
        setup_fn=_setup_scenario_8,
    ),
}
