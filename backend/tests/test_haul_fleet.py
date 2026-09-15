from copy import deepcopy
import math

import pytest

from backend.app.config import project_config
from backend.app.simulation.haul_route import HaulRun
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore


def test_every_truck_loads_tips_returns_empty_and_repeats():
    haul = HaulRun(deepcopy(project_config()["demo"]["demo"]["haul"]))
    fleet = haul.production
    phases = [set() for _ in fleet.trucks]
    completed = []
    for _ in range(8500):
        completed.extend(fleet.advance(0.1, True, 2.5))
        for i, truck in enumerate(fleet.trucks):
            phases[i].add(truck.phase)
            if truck.phase == "HAULING":
                assert truck.payload == truck.plan.payload_fraction
                assert 0.80 <= truck.payload <= 0.99
            if truck.phase == "RETURNING":
                assert truck.payload == 0
            if truck.phase in {"LOADING", "DUMPING", "LOWERING"}:
                assert truck.speed == 0
        assert sum(t.phase == "LOADING" for t in fleet.trucks) <= 1
        assert sum(t.phase in {"REVERSING", "DUMPING", "LOWERING", "EXITING"} for t in fleet.trucks) <= 1
    assert all(t.cycle >= 2 for t in fleet.trucks)
    assert len({trip.trip_id for trip in completed}) == len(completed)
    for index, truck in enumerate(fleet.trucks):
        trips = [trip for trip in completed if trip.vehicle_id == f"DUMPER_{index + 1:02d}"]
        assert len(trips) == truck.cycle - 1
        assert all(trip.source == "SIMULATED" and trip.fuel_litres_est > 0 for trip in trips)
        assert len({trip.payload_tonnes for trip in trips}) == len(trips)
    assert all(p >= {"LOADING", "HAULING", "REVERSING", "DUMPING", "LOWERING", "RETURNING"} for p in phases)
    before = [fleet.pose(i, 1).model_dump(exclude={"speed_mps"}) for i in range(8)]
    fleet.advance(30, False, 2.5)
    assert [fleet.pose(i, 1).model_dump(exclude={"speed_mps"}) for i in range(8)] == before


def test_road_height_has_no_cliff_jumps():
    haul = HaulRun(deepcopy(project_config()["demo"]["demo"]["haul"]))
    heights = [haul.production.height(i / 2) for i in range(math.ceil(haul.route.total_length_m * 2))]
    assert min(heights) == pytest.approx(-16, abs=0.1)
    assert max(abs(a - b) for a, b in zip(heights, heights[1:])) < 0.11


def test_docking_curve_matches_the_bay_and_returns_to_the_road_without_a_heading_jump():
    haul = HaulRun(deepcopy(project_config()["demo"]["demo"]["haul"]))
    fleet = haul.production
    road = haul.route.sample(haul.dump_distance)
    start, end = fleet.dock_pose(0), fleet.dock_pose(1)
    assert start == pytest.approx((road.x_m, road.y_m, road.heading_deg))
    assert end == pytest.approx((road.x_m + 5, road.y_m - 4, 270))
    destination = next(f for f in haul.reference_map.features if f.feature_id == "dump")
    assert end[:2] == pytest.approx((destination.properties["dock_x_m"], destination.properties["dock_y_m"]))
    samples = [fleet.dock_pose(i / 60) for i in range(61)]
    assert max(abs((b[2] - a[2] + 180) % 360 - 180) for a, b in zip(samples, samples[1:])) < 4
    truck = fleet.trucks[0]
    truck.distance = haul.dump_distance
    for phase, t in [("REVERSING", 0), ("EXITING", haul.config["reversing_s"])]:
        truck.phase, truck.timer = phase, t
        pose = fleet.pose(0, 0)
        assert (pose.x_m, pose.y_m, pose.heading_deg) == pytest.approx(start)
    truck.phase, truck.timer = "DUMPING", 2
    pose = fleet.pose(0, 0)
    assert pose.haul.road_pitch_deg == 0
    assert (pose.x_m, pose.y_m, pose.heading_deg) == pytest.approx(end)


@pytest.mark.asyncio
async def test_receiving_bay_cycle_runs_without_a_false_berm_stop():
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    await simulator.tick()
    fleet = simulator._haul.production
    truck = fleet.trucks[0]
    truck.distance, truck.phase, truck.timer, truck.payload = fleet.dump_distance, "REVERSING", 0, 1
    phases = set()
    for _ in range(220):
        state = await simulator.tick()
        phases.add(truck.phase)
        assert not state.emergency.motor_cut
    assert phases >= {"REVERSING", "DUMPING", "LOWERING", "EXITING", "RETURNING"}


@pytest.mark.asyncio
async def test_backend_publishes_eight_independent_loading_states():
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    first = await simulator.tick()
    assert len(first.vehicles) == 8
    assert first.vehicles[0].haul.phase == "LOADING"
    assert all(v.haul.payload_fraction == 0 for v in first.vehicles[1:])
    for _ in range(150):
        state = await simulator.tick()
        assert not state.emergency.motor_cut
    assert state.vehicles[0].haul.phase == "HAULING"
    assert state.vehicles[1].haul.phase == "LOADING"
