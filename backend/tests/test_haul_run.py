from copy import deepcopy
import math

import pytest

from backend.app.config import project_config
from backend.app.models import SimulationScenario
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore


@pytest.mark.asyncio
async def test_haul_circuit_detects_avoids_passes_unloads_and_repeats():
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    phases = set()
    encounters = set()
    minimum_rock_clearance = float("inf")
    saw_early_return = False
    both_slowed = False
    returned = False
    lead_turned = False
    for _ in range(2500):
        state = await simulator.tick()
        assert state.haul_route is not None
        phases.add(state.haul_route.phase)
        assert len(state.vehicles) == 3
        assert len(state.spatial_points) <= 600
        assert not state.emergency.motor_cut
        if state.haul_route.obstacle_detected:
            encounters.add("rock")
            saw_early_return |= state.haul_route.obstacle_distance_m > 2
        if state.haul_route.traffic_slowing:
            encounters.add("oncoming")
            both_slowed |= (
                state.vehicles[0].speed_mps < 0.5 and state.vehicles[1].speed_mps < 0.4
            )
        if state.haul_route.lead_waiting:
            encounters.add("lead")
        lead_turned |= state.vehicles[2].x_m > 30
        if state.haul_route.obstacle:
            p, rock = state.primary_vehicle(), state.haul_route.obstacle
            minimum_rock_clearance = min(
                minimum_rock_clearance, math.hypot(p.x_m - rock.x_m, p.y_m - rock.y_m)
            )
        if state.haul_route.phase == "ARRIVED":
            assert state.primary_vehicle().speed_mps == pytest.approx(0, abs=0.001)
        returned |= state.haul_route.destination == "Mine loading bay"
        if state.haul_route.cycle == 2:
            break
    assert phases >= {"HAULING", "OBSTACLE", "ARRIVED"}
    assert encounters == {"rock", "oncoming", "lead"}
    assert saw_early_return and both_slowed and lead_turned and returned
    assert minimum_rock_clearance > 1.1
    assert state.haul_route.cycle == 2
    assert state.haul_route.destination == "Dump point"
    assert not state.haul_route.obstacle_detected


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


@pytest.mark.asyncio
async def test_rock_warning_requires_valid_front_sensor_hit():
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    state = await simulator.tick()
    haul = simulator._haul
    reading = next(r for r in state.ranges if r.sensor_id == "front_fixed")
    targets = {"front_fixed": "simulated-live-obstacle"}
    haul.observe([reading.model_copy(update={"is_valid": False})], targets)
    haul.observe([reading.model_copy(update={"quality": 0.2})], targets)
    haul.observe([reading], {"front_fixed": "road-berm"})
    assert not haul.obstacle_detected
    haul.observe([reading], targets)
    assert haul.obstacle_detected
    assert len(haul.snapshot(1, True, False).planned_path) == 21
