from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

from backend.app.fleet.fleet_manager import FleetManager
from backend.app.fleet.models import HaulCycleState
from backend.app.mine_map.graph import MineRoadGraph
from backend.app.mine_map.models import RoadStatus
from backend.app.models.telemetry import Point2D, SimulationScenario
from backend.app.models.v2x import V2IAdvisoryMessage, V2IAdvisoryType
from backend.app.navigation.models import RouteRequest
from backend.app.v2x.manager import V2XManager


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
    setup_fn: Callable[[FleetManager, MineRoadGraph, V2XManager], None] | None = None


def _setup_scenario_1(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 1: Dense Fog Normal Haulage - Visibility drops to 15%, synthetic overlay active."""
    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
    # Post V2I fog warning advisory
    rsu = next(iter(v2x._rsus.values()), None)
    if rsu:
        adv = V2IAdvisoryMessage(
            message_id="ADV-SCEN-01",
            rsu_id=rsu.rsu_id,
            rsu_name=rsu.name,
            advisory_type=V2IAdvisoryType.FOG_WARNING,
            title="Dense Fog Warning - Visibility 15%",
            detail="Extreme fog on main haul ramps. Synthetic radar/ToF corridor mandatory.",
            speed_limit_kmh=15.0,
            zone_x_m=20.0,
            zone_y_m=45.0,
            zone_radius_m=120.0,
        )
        v2x.broadcast_advisory(adv)


def _setup_scenario_2(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 2: Vehicle Ahead - Lead truck ahead slowing down; closing speed warning triggered."""
    v1 = fleet.get_vehicle("DUMPER_01")
    v2 = fleet.get_vehicle("DUMPER_02")
    if v1 and v2:
        v1.clear_emergency()
        v1.resume()
        v1.set_position(x_m=15.0, y_m=80.0, elevation_m=555.0, heading_deg=180.0)
        v1.speed_mps = 7.0  # 25 km/h
        # Position DUMPER_02 22m directly ahead slowing down
        v2.clear_emergency()
        v2.resume()
        v2.set_position(x_m=15.0, y_m=58.0, elevation_m=570.0, heading_deg=180.0)
        v2.speed_mps = 1.5  # 5 km/h crawl


def _setup_scenario_3(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 3: Opposing Vehicle - Two dumpers approach on narrow single-way haul segment."""
    v1 = fleet.get_vehicle("DUMPER_01")
    v2 = fleet.get_vehicle("DUMPER_02")
    if v1 and v2:
        v1.clear_emergency()
        v1.resume()
        v1.set_position(x_m=10.0, y_m=35.0, elevation_m=580.0, heading_deg=0.0)  # heading North
        v1.speed_mps = 5.0
        # Position DUMPER_02 26m ahead heading South directly towards DUMPER_01
        v2.clear_emergency()
        v2.resume()
        v2.set_position(x_m=10.0, y_m=61.0, elevation_m=570.0, heading_deg=180.0)  # heading South
        v2.speed_mps = 4.5


def _setup_scenario_4(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 4: Static Obstacle - Fallen boulder on haul road detected by range sensing."""
    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
        # Ensure obstacle is right in forward path


def _setup_scenario_5(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 5: Road Closure & Automatic Reroute - V2I closes haul segment; vehicle reroutes."""
    # Close steep ramp segment
    graph.update_edge_status("E_STEEP_RAMP_A", RoadStatus.CLOSED)
    v1 = fleet.get_vehicle("DUMPER_01")
    if v1:
        v1.clear_emergency()
        v1.resume()
        # Force reroute to gentle bypass
        req = RouteRequest(
            start_node_id="J_HAUL_05",
            end_node_id="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=v1.payload_tonnes,
            vehicle_id=v1.vehicle_id,
        )
        new_route = fleet.router.find_route(req)
        if new_route:
            v1.assign_route(new_route)

    rsu = next(iter(v2x._rsus.values()), None)
    if rsu:
        adv = V2IAdvisoryMessage(
            message_id="ADV-SCEN-05",
            rsu_id=rsu.rsu_id,
            rsu_name=rsu.name,
            advisory_type=V2IAdvisoryType.ROAD_MAINTENANCE,
            title="Ramp Closure: Steep Incline Closed",
            detail="Boulder clearing in progress on E_STEEP_RAMP_A. Rerouting via Perimeter Bypass.",
            speed_limit_kmh=20.0,
            zone_x_m=10.0,
            zone_y_m=45.0,
            zone_radius_m=50.0,
        )
        v2x.broadcast_advisory(adv)


def _setup_scenario_6(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 6: Payload-Based Routing - Loaded dumper takes flat route vs Empty dumper taking steep shortcut."""
    # Ensure all roads are open
    graph.update_edge_status("E_STEEP_RAMP_A", RoadStatus.OPEN)
    graph.update_edge_status("E_STEEP_RAMP_B", RoadStatus.OPEN)

    v1 = fleet.get_vehicle("DUMPER_01")
    v2 = fleet.get_vehicle("DUMPER_02")
    if v1 and v2:
        v1.clear_emergency()
        v1.resume()
        v1.payload_tonnes = 100.0  # Fully Loaded 100T
        v1.cycle_state = HaulCycleState.TRAVELLING_TO_DUMP
        route_loaded = fleet.router.find_route(RouteRequest(
            start_node_id="PICKUP_NORTH_BENCH",
            end_node_id="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=100.0,
            vehicle_id="DUMPER_01",
        ))
        if route_loaded:
            v1.assign_route(route_loaded)

        v2.clear_emergency()
        v2.resume()
        v2.payload_tonnes = 0.0  # Empty 0T
        v2.cycle_state = HaulCycleState.RETURNING_EMPTY
        route_empty = fleet.router.find_route(RouteRequest(
            start_node_id="PICKUP_NORTH_BENCH",
            end_node_id="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=0.0,
            vehicle_id="DUMPER_02",
        ))
        if route_empty:
            v2.assign_route(route_empty)


def _setup_scenario_7(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 7: Supervisor Fleet Monitoring - Multiple dumpers running concurrent haulage cycles."""
    for veh in fleet.vehicles.values():
        veh.clear_emergency()
        veh.resume()


def _setup_scenario_8(fleet: FleetManager, graph: MineRoadGraph, v2x: V2XManager) -> None:
    """Scenario 8: Haulage Analytics - Review of completed trips, cycle times, and operational delays."""
    for veh in fleet.vehicles.values():
        veh.clear_emergency()
        veh.resume()


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
