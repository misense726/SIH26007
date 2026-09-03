from __future__ import annotations

from copy import deepcopy
import pytest

from backend.app.config import project_config
from backend.app.mine_map.models import RoadStatus
from backend.app.models.telemetry import CorridorState, SimulationScenario
from backend.app.simulation.engine import FullSimulator
from backend.app.simulation.scenarios import ALL_SCENARIOS
from backend.app.twin.world_store import WorldStore


@pytest.mark.asyncio
async def test_all_8_scenarios_can_be_applied() -> None:
    config = deepcopy(project_config())
    simulator = FullSimulator(WorldStore(), config, telemetry_hz=10)

    scenarios = [
        SimulationScenario.SCENARIO_1_DENSE_FOG,
        SimulationScenario.SCENARIO_2_VEHICLE_AHEAD,
        SimulationScenario.SCENARIO_3_OPPOSING_VEHICLE,
        SimulationScenario.SCENARIO_4_STATIC_OBSTACLE,
        SimulationScenario.SCENARIO_5_ROAD_CLOSURE_REROUTE,
        SimulationScenario.SCENARIO_6_PAYLOAD_ROUTING,
        SimulationScenario.SCENARIO_7_FLEET_MONITORING,
        SimulationScenario.SCENARIO_8_HAULAGE_ANALYTICS,
    ]

    for scenario in scenarios:
        assert scenario in ALL_SCENARIOS
        state = await simulator.apply_control_and_tick(scenario=scenario)
        assert state.simulation.scenario == scenario

        if scenario == SimulationScenario.SCENARIO_1_DENSE_FOG:
            assert state.environment.visibility_score <= 0.20
            advisories = state.v2x.active_advisories
            assert any("Fog" in adv.title for adv in advisories)

        elif scenario == SimulationScenario.SCENARIO_2_VEHICLE_AHEAD:
            warning = simulator.fleet_manager.get_tactical_collision_warning("DUMPER_01")
            assert warning.threat_level in {"WARNING", "CRITICAL"}
            assert warning.target_vehicle_id == "DUMPER_02"
            assert warning.closing_velocity_mps > 0.0

        elif scenario == SimulationScenario.SCENARIO_3_OPPOSING_VEHICLE:
            warning = simulator.fleet_manager.get_tactical_collision_warning("DUMPER_01")
            assert warning.threat_level in {"WARNING", "CRITICAL"}
            assert warning.target_vehicle_id == "DUMPER_02"
            assert warning.direction == "FRONT"

        elif scenario == SimulationScenario.SCENARIO_4_STATIC_OBSTACLE:
            assert state.simulation.obstacle_enabled is True
            assert state.safe_corridor.state in {CorridorState.RED, CorridorState.YELLOW}

        elif scenario == SimulationScenario.SCENARIO_5_ROAD_CLOSURE_REROUTE:
            edge = simulator.mine_graph.get_edge("E_STEEP_RAMP_A")
            assert edge is not None
            assert edge.road_status == RoadStatus.CLOSED
            v1 = simulator.fleet_manager.get_vehicle("DUMPER_01")
            assert v1 is not None
            assert v1.current_route is not None
            assert "E_STEEP_RAMP_A" not in v1.current_route.edge_ids
            assert len(simulator.fleet_manager.reroute_advisories) > 0

        elif scenario == SimulationScenario.SCENARIO_6_PAYLOAD_ROUTING:
            v1 = simulator.fleet_manager.get_vehicle("DUMPER_01")
            v2 = simulator.fleet_manager.get_vehicle("DUMPER_02")
            assert v1 is not None and v2 is not None
            assert v1.payload_tonnes == 100.0
            assert v2.payload_tonnes == 0.0
            assert v1.current_route is not None
            assert v2.current_route is not None
            assert "WP_RAMP_02" in v1.current_route.path_nodes
            assert "WP_RAMP_01" in v2.current_route.path_nodes

        elif scenario == SimulationScenario.SCENARIO_7_FLEET_MONITORING:
            assert len(state.vehicles) == 4
            vehicle_ids = {v.vehicle_id for v in state.vehicles}
            assert vehicle_ids == {"DUMPER_01", "DUMPER_02", "DUMPER_03", "HAULER_04"}

        elif scenario == SimulationScenario.SCENARIO_8_HAULAGE_ANALYTICS:
            metrics = simulator.analytics.get_haulage_metrics(active_fleet_count=4)
            assert metrics.total_completed_cycles > 0
            assert metrics.total_ore_moved_tonnes > 0.0


@pytest.mark.asyncio
async def test_scenario_isolation_order_independence() -> None:
    config = deepcopy(project_config())
    simulator = FullSimulator(WorldStore(), config, telemetry_hz=10)

    # Apply Scenario 5 (which closes E_STEEP_RAMP_A)
    await simulator.apply_control_and_tick(scenario=SimulationScenario.SCENARIO_5_ROAD_CLOSURE_REROUTE)
    assert simulator.mine_graph.get_edge("E_STEEP_RAMP_A").road_status == RoadStatus.CLOSED

    # Apply Scenario 1 next
    await simulator.apply_control_and_tick(scenario=SimulationScenario.SCENARIO_1_DENSE_FOG)
    # E_STEEP_RAMP_A must be restored to OPEN by baseline reset
    assert simulator.mine_graph.get_edge("E_STEEP_RAMP_A").road_status == RoadStatus.OPEN
