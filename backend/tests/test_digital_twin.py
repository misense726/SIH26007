from __future__ import annotations

import math

import pytest

from backend.app.models import MapFeatureType, Point2D, VehiclePose, WorldState
from backend.app.simulation.foundation import FoundationSimulator
from backend.app.twin.map_store import load_reference_map
from backend.app.twin.route import PolylineRoute
from backend.app.twin.world_store import WorldStore


def test_reference_map_contains_required_base_features() -> None:
    reference_map = load_reference_map("maps/test_route.json")
    feature_types = {feature.feature_type for feature in reference_map.features}
    assert {
        MapFeatureType.ROAD,
        MapFeatureType.CENTERLINE,
        MapFeatureType.BERM,
        MapFeatureType.HAZARD_ZONE,
        MapFeatureType.ROUTE,
        MapFeatureType.START,
        MapFeatureType.DESTINATION,
    } <= feature_types


def test_route_heading_uses_clockwise_degrees_from_positive_y() -> None:
    route = PolylineRoute([Point2D(x_m=0, y_m=0), Point2D(x_m=2, y_m=2)])
    sample = route.sample(math.sqrt(2))
    assert sample.x_m == pytest.approx(1.0)
    assert sample.y_m == pytest.approx(1.0)
    assert sample.heading_deg == pytest.approx(45.0)


def test_open_route_clamps_before_start_and_at_destination() -> None:
    route = PolylineRoute([Point2D(x_m=0, y_m=0), Point2D(x_m=0, y_m=2)])

    before_start = route.sample(-1.0)
    past_destination = route.sample(3.0)

    assert (before_start.x_m, before_start.y_m) == pytest.approx((0.0, 0.0))
    assert (past_destination.x_m, past_destination.y_m) == pytest.approx((0.0, 2.0))


@pytest.mark.asyncio
async def test_simulated_vehicle_moves_on_the_canonical_route() -> None:
    store = WorldStore()
    simulator = FoundationSimulator(store, telemetry_hz=10, route_speed_mps=1.0)
    first = await simulator.tick()
    second = await simulator.tick()
    first_pose = first.primary_vehicle()
    second_pose = second.primary_vehicle()
    assert second_pose.y_m > first_pose.y_m
    assert second_pose.x_m == pytest.approx(5.0)
    assert second.reference_map is not None
    assert second.reference_map.map_id == "FOGSEN_TEST_ROUTE_01"
    assert second.safe_corridor.state == "GREY"


@pytest.mark.asyncio
async def test_world_store_copies_nested_reference_map() -> None:
    store = WorldStore()
    simulator = FoundationSimulator(store)
    state = await simulator.tick()
    snapshot = await store.snapshot()
    assert snapshot.reference_map is not None
    snapshot.reference_map.name = "mutated outside store"
    untouched = await store.snapshot()
    assert untouched.reference_map is not None
    assert untouched.reference_map.name == state.reference_map.name


def test_world_model_supports_multiple_dumpers() -> None:
    world = WorldState(
        primary_vehicle_id="DUMPER_02",
        vehicles=[
            VehiclePose(vehicle_id="DUMPER_01"),
            VehiclePose(vehicle_id="DUMPER_02", x_m=4.0),
        ],
    )
    assert world.primary_vehicle().x_m == 4.0
    assert len(world.model_dump()["vehicles"]) == 2
