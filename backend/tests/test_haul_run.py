from copy import deepcopy
import math

import pytest

from backend.app.config import project_config
from backend.app.models import SimulationScenario
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore
from backend.app.simulation.haul_route import HaulRun
from backend.app.safety.corridor import CorridorEvaluator
from shapely.geometry import Point


def test_pit_route_starts_at_floor_and_stays_on_usable_road():
    config = deepcopy(project_config()["demo"]["demo"]["haul"])
    original = deepcopy(config)
    haul = HaulRun(config)
    assert config == original
    floor = next(f.points[0] for f in haul.reference_map.features
                 if f.properties.get("cartography") == "pit-floor")
    start = haul.route.sample(0)
    assert math.hypot(start.x_m - floor.x_m, start.y_m - floor.y_m) < 1.1
    corridor = CorridorEvaluator(haul.reference_map, 0.5, 0.4, 0.5)
    for distance in range(math.ceil(haul.route.total_length_m)):
        sample = haul.route.sample(distance)
        point = Point(sample.x_m, sample.y_m)
        assert corridor.road.buffer(-0.5).covers(point)
        assert not corridor.hazards.covers(point)


def test_haul_corner_positions_and_headings_are_continuous():
    haul = HaulRun(project_config()["demo"]["demo"]["haul"])
    before = haul.route.sample(haul.route.total_length_m - 0.001)
    after = haul.route.sample(0.001)
    assert abs((after.heading_deg - before.heading_deg + 180) % 360 - 180) < 0.1
    assert math.hypot(after.x_m - before.x_m, after.y_m - before.y_m) < 0.00201
    for route in (haul.route, haul.lead_route):
        distance = 0.0
        for i, length in enumerate(route.segment_lengths[:-1]):
            distance += length
            span = min(haul.config["corner_blend_m"], length * 0.45,
                       route.segment_lengths[i + 1] * 0.45)
            for join in (distance - span, distance, distance + span):
                before, after = route.sample(join - 0.00001), route.sample(join + 0.00001)
                turn = abs((after.heading_deg - before.heading_deg + 180) % 360 - 180)
                assert turn < 0.1
                assert math.hypot(after.x_m - before.x_m, after.y_m - before.y_m) <= 0.00201


@pytest.mark.asyncio
async def test_haul_reaches_faster_cruise_speed():
    config = deepcopy(project_config())
    simulator = FullSimulator(WorldStore(), config)
    speeds = [(await simulator.tick()).primary_vehicle().speed_mps for _ in range(150)]
    expected_speed = min(
        config["demo"]["demo"]["haul"]["cruise_speed_mps"]
        * config["demo"]["demo"]["default_speed_scale"],
        config["vehicle"]["vehicle"]["max_demo_speed_mps"],
    )
    assert max(speeds) == pytest.approx(expected_speed * simulator._haul.production.trucks[0].plan.speed_scale)


@pytest.mark.asyncio
async def test_haul_circuit_detects_avoids_passes_unloads_and_repeats():
    config = deepcopy(project_config())
    config["demo"]["demo"]["haul"]["production_cycle"] = False
    simulator = FullSimulator(WorldStore(), config)
    early_warning_threshold_m = config["demo"]["demo"]["haul"]["rock_detour_span_m"] / 3
    phases = set()
    encounters = set()
    minimum_rock_clearance = float("inf")
    saw_early_return = False
    both_slowed = False
    returned = False
    lead_turned = False
    for _ in range(math.ceil(simulator._haul.route.total_length_m / 0.15) + 2500):
        state = await simulator.tick()
        assert state.haul_route is not None
        phases.add(state.haul_route.phase)
        assert len(state.vehicles) == 8
        assert len(state.spatial_points) <= 600
        assert not state.emergency.motor_cut
        if state.haul_route.obstacle_detected:
            encounters.add("rock")
            saw_early_return |= state.haul_route.obstacle_distance_m > early_warning_threshold_m
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
    assert len(paused.vehicles) == 8
    assert len({v.vehicle_id for v in paused.vehicles}) == 8
    assert [(v.x_m, v.y_m) for v in paused.vehicles[1:]] == [(v.x_m, v.y_m) for v in before.vehicles[1:]]
    assert all(v.speed_mps == 0 for v in paused.vehicles)
    await simulator.apply_control(reset=True)
    reset = await simulator.tick()
    assert reset.haul_route.distance_m == pytest.approx(before.haul_route.distance_m)
    assert [(v.x_m, v.y_m) for v in reset.vehicles[3:]] == [(v.x_m, v.y_m) for v in before.vehicles[3:]]
    await simulator.apply_control(scenario=SimulationScenario.NORMAL)
    normal = await simulator.tick()
    assert normal.haul_route is None
    assert len(normal.vehicles) == 1
    assert normal.reference_map.map_id != before.reference_map.map_id


@pytest.mark.asyncio
async def test_rock_warning_requires_valid_front_sensor_hit():
    config = deepcopy(project_config())
    config["demo"]["demo"]["haul"]["production_cycle"] = False
    simulator = FullSimulator(WorldStore(), config)
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
