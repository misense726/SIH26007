from __future__ import annotations

from copy import deepcopy
import pytest

from backend.app.config import project_config
from backend.app.models.telemetry import SimulationScenario
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

        elif scenario == SimulationScenario.SCENARIO_4_STATIC_OBSTACLE:
            assert state.simulation.obstacle_enabled is True

        elif scenario == SimulationScenario.SCENARIO_6_PAYLOAD_ROUTING:
            v1 = simulator.fleet_manager.get_vehicle("DUMPER_01")
            v2 = simulator.fleet_manager.get_vehicle("DUMPER_02")
            assert v1.payload_tonnes == 100.0
            assert v2.payload_tonnes == 0.0
            if v1.current_route:
                assert "WP_RAMP_02" in v1.current_route.path_nodes
            if v2.current_route:
                assert "WP_RAMP_01" in v2.current_route.path_nodes

        elif scenario == SimulationScenario.SCENARIO_7_FLEET_MONITORING:
            assert len(state.vehicles) >= 3
