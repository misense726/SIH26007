from copy import deepcopy

import pytest

from backend.app.config import project_config
from backend.app.models import SimulationScenario
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore


@pytest.mark.asyncio
async def test_haul_encounter_stops_clears_and_arrives_on_the_same_route():
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    phases = set()
    first_peer_y = None
    saw_range_obstacle = False
    for _ in range(750):
        state = await simulator.tick()
        assert state.haul_route is not None
        phases.add(state.haul_route.phase)
        if first_peer_y is None:
            first_peer_y = state.vehicles[1].y_m
        assert len(state.vehicles) == 2
        assert len(state.spatial_points) <= 600
        if state.emergency.motor_cut:
            saw_range_obstacle = any(
                r.sensor_id == "front_fixed" and r.range_m < 1 for r in state.ranges
            )
        if state.haul_route.phase == "ARRIVED":
            break
    assert phases >= {"HAULING", "OBSTACLE", "WAITING", "ARRIVED"}
    assert saw_range_obstacle
    assert state.vehicles[1].y_m < first_peer_y
    assert state.haul_route.remaining_m == pytest.approx(0)
    assert not state.emergency.motor_cut
    assert state.primary_vehicle().x_m == pytest.approx(30, abs=0.05)


@pytest.mark.asyncio
async def test_pause_freezes_encounter_and_both_vehicles_and_reset_restarts():
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    before = await simulator.tick()
    await simulator.apply_control(running=False)
    for _ in range(10):
        paused = await simulator.tick()
    assert paused.haul_route.elapsed_s == before.haul_route.elapsed_s
    assert paused.haul_route.distance_m == before.haul_route.distance_m
    assert paused.vehicles[1].y_m == before.vehicles[1].y_m
    assert all(v.speed_mps == 0 for v in paused.vehicles)
    await simulator.apply_control(reset=True)
    reset = await simulator.tick()
    assert reset.haul_route.distance_m == pytest.approx(before.haul_route.distance_m)
    await simulator.apply_control(scenario=SimulationScenario.NORMAL)
    normal = await simulator.tick()
    assert normal.haul_route is None
    assert len(normal.vehicles) == 1
    assert normal.reference_map.map_id != before.reference_map.map_id
