from collections import Counter
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.app.analytics.simulated_haul import (
    PAYLOAD_CAPACITIES_TONNES, baseline_trips, cycle_plan, estimate_fuel_litres,
)
from backend.app.analytics.trip_logger import HaulageAnalyticsEngine
from backend.app.config import RuntimeSettings, project_config
from backend.app.fleet.models import TripRecord
from backend.app.main import create_app
from backend.app.models import SimulationScenario
from backend.app.simulation.engine import FullSimulator
from backend.app.simulation.haul_route import HaulRun
from backend.app.twin.world_store import WorldStore


ANCHOR_MS = 1_783_036_800_000


def test_visible_api_documentation_uses_mi_sense_name():
    from backend.app.simulation_app import create_simulation_app

    for factory, title in ((create_app, "MI Sense API"),
                           (create_simulation_app, "MI Sense Simulation API")):
        info = factory(RuntimeSettings()).openapi()["info"]
        assert info["title"] == title
        assert "MI Sense" in info["description"]
        assert "FogSen" not in info["description"]


def test_baseline_has_fifteen_distinct_valid_efficiencies_per_vehicle():
    analytics = HaulageAnalyticsEngine(baseline_end_ms=ANCHOR_MS)
    history = analytics.get_trip_history(limit=200)
    assert history.total_trips == len(history.trips) == 120
    assert len({trip.trip_id for trip in history.trips}) == 120
    assert history.total_tonnes == round(sum(trip.payload_tonnes for trip in history.trips), 1)
    for index, capacity in enumerate(PAYLOAD_CAPACITIES_TONNES):
        vehicle_id = f"DUMPER_{index + 1:02d}"
        selected = analytics.get_trip_history(limit=15, vehicle_id=vehicle_id)
        assert selected.total_trips == len(selected.trips) == 15
        assert len({f"{trip.payload_tonnes * trip.distance_km / trip.fuel_litres_est:.2f}"
                    for trip in selected.trips}) == 15
        assert len({trip.payload_tonnes for trip in selected.trips}) == 15
        assert len({trip.fuel_litres_est for trip in selected.trips}) == 15
        assert len({trip.cycle_duration_s for trip in selected.trips}) == 15
        assert selected.total_tonnes == round(sum(trip.payload_tonnes for trip in selected.trips), 1)
        for trip in selected.trips:
            assert trip.source == "SIMULATED"
            assert capacity * 0.80 <= trip.payload_tonnes <= capacity
            assert trip.start_time_ms < trip.end_time_ms <= ANCHOR_MS
            assert trip.cycle_duration_s == pytest.approx((trip.end_time_ms - trip.start_time_ms) / 1000)
            assert trip.cycle_duration_s == pytest.approx(sum((trip.loading_wait_s, trip.loaded_travel_s,
                trip.dumping_wait_s, trip.empty_return_s, trip.idle_s)))
            assert trip.distance_km > 0 and trip.fuel_litres_est > 0
        for latest, earlier in zip(selected.trips, selected.trips[1:]):
            assert latest.start_time_ms >= earlier.end_time_ms
    metrics = analytics.get_haulage_metrics(active_fleet_count=8)
    assert metrics.total_completed_cycles == history.total_trips
    assert metrics.total_ore_moved_tonnes == history.total_tonnes
    assert metrics.cycles_by_vehicle == dict.fromkeys(metrics.ore_moved_by_vehicle, 15)


def test_seed_and_reset_are_deterministic_and_live_stays_empty():
    assert baseline_trips(ANCHOR_MS) == baseline_trips(ANCHOR_MS)
    assert baseline_trips(ANCHOR_MS, seed=7) != baseline_trips(ANCHOR_MS)
    engine = HaulageAnalyticsEngine(baseline_end_ms=ANCHOR_MS)
    before = engine.get_trip_history(200)
    trip = before.trips[0].model_copy(update={"trip_id": "EXTRA"})
    engine.record_trip(trip)
    engine.reset()
    assert engine.get_trip_history(200) == before
    live = HaulageAnalyticsEngine(seed_baseline=False)
    live.reset()
    assert live.get_trip_history(200).trips == []
    assert live.get_haulage_metrics(active_fleet_count=0).total_completed_cycles == 0
    assert TripRecord.model_validate(trip.model_dump(exclude={"source"})).source is None


def test_cycle_load_sequence_is_bounded_stable_and_varies_every_cycle():
    for index, capacity in enumerate(PAYLOAD_CAPACITIES_TONNES):
        previous = None
        for cycle in range(1, 501):
            plan = cycle_plan(index, cycle)
            assert plan == cycle_plan(index, cycle)
            assert capacity * 0.80 <= plan.payload_tonnes <= capacity
            assert plan.payload_tonnes != previous
            previous = plan.payload_tonnes


def test_estimated_fuel_responds_to_load_distance_speed_and_idle():
    base = dict(payload_tonnes=80, loaded_distance_km=1, empty_distance_km=1,
                travel_s=400, loading_s=150, dumping_s=90, idle_s=30)
    fuel = estimate_fuel_litres(**base)
    for change in ({"payload_tonnes": 100}, {"loaded_distance_km": 2, "travel_s": 600},
                   {"travel_s": 800}, {"idle_s": 150}):
        assert estimate_fuel_litres(**{**base, **change}) > fuel


def test_retention_preserves_fifteen_per_truck_and_matching_totals():
    engine = HaulageAnalyticsEngine(baseline_end_ms=ANCHOR_MS)
    trip = engine.get_trip_history(1, vehicle_id="DUMPER_01").trips[0]
    for number in range(250):
        added = trip.model_copy(update={"trip_id": f"NEW-{number}", "end_time_ms": ANCHOR_MS + number + 1})
        engine.record_trip(added)
        engine.record_trip(added)  # repeated delivery must not double count
    history = engine.get_trip_history(200)
    assert history.total_trips == len(history.trips) == 200
    counts = Counter(item.vehicle_id for item in history.trips)
    assert all(count >= 15 for count in counts.values())
    assert len(counts) == 8
    assert [trip.end_time_ms for trip in history.trips] == sorted(
        (trip.end_time_ms for trip in history.trips), reverse=True)
    filtered = engine.get_trip_history(15, vehicle_id="DUMPER_01")
    matching = [trip for trip in history.trips if trip.vehicle_id == "DUMPER_01"]
    assert filtered.total_trips == len(matching)
    assert filtered.total_tonnes == round(sum(trip.payload_tonnes for trip in matching), 1)
    assert engine.get_trip_history(15, vehicle_id="UNKNOWN").model_dump() == {
        "trips": [], "total_trips": 0, "total_tonnes": 0.0,
    }
    assert engine.get_haulage_metrics().total_ore_moved_tonnes == history.total_tonnes


def test_api_filters_before_limiting_and_rejects_out_of_range_limits():
    with TestClient(create_app()) as client:
        all_history = client.get("/api/analytics/trip-history?limit=200").json()
        assert all_history["total_trips"] == 120
        for index in range(8):
            vehicle_id = f"DUMPER_{index + 1:02d}"
            response = client.get("/api/analytics/trip-history", params={"vehicle_id": vehicle_id, "limit": 15})
            assert response.status_code == 200
            history = response.json()
            assert history["total_trips"] == len(history["trips"]) == 15
            assert all(trip["vehicle_id"] == vehicle_id and trip["source"] == "SIMULATED"
                       for trip in history["trips"])
        for invalid in (0, -1, 201):
            assert client.get("/api/analytics/trip-history", params={"limit": invalid}).status_code == 422
        missing = client.get("/api/analytics/trip-history?vehicle_id=UNKNOWN").json()
        assert missing == {"trips": [], "total_trips": 0, "total_tonnes": 0.0}
        fleet = client.get("/api/fleet/vehicles").json()
        assert {truck["vehicle_id"] for truck in fleet} == {f"DUMPER_{i + 1:02d}" for i in range(8)}
        assert all(truck["total_trips_completed"] == 15 for truck in fleet)


def test_live_api_never_generates_demo_history(monkeypatch, tmp_path):
    def no_simulated_seed(*args, **kwargs):
        pytest.fail("LIVE must never construct simulated history or a haul simulator")

    def disconnected_reader(*args):
        raise OSError("No hardware in this test")

    monkeypatch.setattr("backend.app.analytics.trip_logger.baseline_trips", no_simulated_seed)
    monkeypatch.setattr("backend.app.main.FullSimulator", no_simulated_seed)
    settings = RuntimeSettings(runtime_mode="LIVE", serial_port="TEST_ONLY",
                               sensor_settings_path=tmp_path / "settings.json")
    app = create_app(settings, serial_factory=disconnected_reader)
    with TestClient(app) as client:
        for query in ("", "?vehicle_id=DUMPER_01&limit=15", "?vehicle_id=DUMPER_08&limit=200"):
            assert client.get(f"/api/analytics/trip-history{query}").json() == {
                "trips": [], "total_trips": 0, "total_tonnes": 0.0,
            }
        assert client.get("/api/fleet/vehicles").json() == []
        metrics = client.get("/api/analytics/haulage-metrics").json()
        assert metrics["total_completed_cycles"] == metrics["active_fleet_count"] == 0
        assert app.state.simulator is None
        # A controlled incoming LIVE record is returned unchanged, not padded
        # with illustrative hauls to reach fifteen rows.
        record = TripRecord(
            trip_id="LIVE-TEST-1", vehicle_id="DUMPER_01", callsign="Test instrumented truck",
            source="LIVE", pickup_node="A", dump_node="B", payload_tonnes=80,
            start_time_ms=1000, end_time_ms=61000, cycle_duration_s=60,
            loading_wait_s=10, loaded_travel_s=20, dumping_wait_s=10,
            empty_return_s=15, idle_s=5, distance_km=0.2, avg_speed_kmh=12,
            fuel_litres_est=1.5,
        )
        app.state.analytics.record_trip(record)
        history = client.get("/api/analytics/trip-history?vehicle_id=DUMPER_01&limit=15").json()
        assert history["trips"] == [record.model_dump(mode="json")]
        assert history["total_trips"] == 1
        assert client.get("/api/analytics/trip-history?vehicle_id=DUMPER_08").json()["trips"] == []


def test_emergency_downtime_counts_idle_and_fuel_but_operator_pause_freezes():
    def completed_primary(stop_kind=None):
        fleet = HaulRun(deepcopy(project_config()["demo"]["demo"]["haul"])).production
        stopped = False
        for _ in range(12000):
            if stop_kind and not stopped and fleet.trucks[0].phase == "HAULING":
                before = [fleet.pose(i, 0).model_dump(exclude={"speed_mps"}) for i in range(8)]
                records = fleet.advance(60, stop_kind != "pause", 2.5,
                                        emergency_stopped=stop_kind == "emergency")
                assert records == []
                assert [fleet.pose(i, 0).model_dump(exclude={"speed_mps"}) for i in range(8)] == before
                stopped = True
            completed = fleet.advance(0.1, True, 2.5)
            primary = next((trip for trip in completed if trip.vehicle_id == "DUMPER_01"), None)
            if primary:
                return primary
        pytest.fail("Primary trip did not complete")

    normal = completed_primary()
    paused = completed_primary("pause")
    emergency = completed_primary("emergency")
    assert paused == normal
    assert emergency.payload_tonnes == normal.payload_tonnes
    assert emergency.distance_km == normal.distance_km
    assert emergency.start_time_ms == normal.start_time_ms
    assert emergency.end_time_ms == normal.end_time_ms + 60_000
    assert emergency.cycle_duration_s == pytest.approx(normal.cycle_duration_s + 60)
    assert emergency.idle_s == pytest.approx(normal.idle_s + 60)
    assert emergency.fuel_litres_est > normal.fuel_litres_est


@pytest.mark.asyncio
async def test_primary_emergency_is_preserved_in_haul_metadata_and_fleet_api_shape(monkeypatch):
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    original_read = simulator.range_provider.read_ranges

    async def blocked_ranges():
        readings = await original_read()
        return [reading.model_copy(update={"range_m": 0.05}) if reading.sensor_id == "front_fixed"
                else reading for reading in readings]

    monkeypatch.setattr(simulator.range_provider, "read_ranges", blocked_ranges)
    before_idle = simulator._haul.production.trucks[0].accounting.idle_s
    for _ in range(20):
        world = await simulator.tick()
    assert world.emergency.motor_cut
    assert world.emergency.state.value == "EMERGENCY_STOP"
    assert world.operations.fleet["DUMPER_01"].emergency_state == "EMERGENCY_STOP"
    assert simulator.get_fleet_summaries()[0].emergency_state == "EMERGENCY_STOP"
    assert simulator._haul.production.trucks[0].accounting.idle_s > before_idle
    assert simulator.analytics.get_trip_history(200).total_trips == 120


@pytest.mark.asyncio
async def test_primary_completion_is_ingested_once_and_reset_restarts_the_load_sequence():
    simulator = FullSimulator(WorldStore(), deepcopy(project_config()))
    fleet = simulator._haul.production
    initial_history = simulator.analytics.get_trip_history(200)
    target = fleet.trucks[0].plan.payload_tonnes
    # Advance only physical haul cycles until the real primary return is nearly
    # complete. Leave completion to FullSimulator to exercise its ingestion path.
    for _ in range(12000):
        truck = fleet.trucks[0]
        if truck.phase == "RETURNING" and fleet.route.total_length_m - truck.distance < 0.2:
            break
        simulator._timestamp_ms += 100
        assert fleet.advance(0.1, True, 2.5, simulator._timestamp_ms) == []
    else:
        pytest.fail("Primary did not return to the loading bay")
    for _ in range(20):
        world = await simulator.tick()
    history = simulator.analytics.get_trip_history(200)
    assert history.total_trips == 121
    completed = [trip for trip in history.trips if trip.trip_id.startswith("SIM-HAUL-")]
    assert len(completed) == 1
    trip = completed[0]
    assert trip.vehicle_id == "DUMPER_01" and trip.source == "SIMULATED"
    assert trip.payload_tonnes == target
    assert trip.fuel_litres_est > 0
    assert trip.cycle_duration_s == pytest.approx(sum((trip.loading_wait_s, trip.loaded_travel_s,
        trip.dumping_wait_s, trip.empty_return_s, trip.idle_s)))
    assert fleet.trucks[0].plan.payload_tonnes != target
    assert len(world.operations.fleet) == world.operations.analytics_summary.active_fleet_count == 8
    assert world.operations.analytics_summary.total_completed_cycles == 121
    assert world.operations.fleet["DUMPER_01"].total_trips_completed == 16
    for pose in world.vehicles:
        metadata = world.operations.fleet[pose.vehicle_id]
        assert pose.haul.payload_tonnes == metadata.payload_tonnes
        assert pose.haul.payload_capacity_tonnes == metadata.target_payload_tonnes
    # Re-selecting HAUL keeps history and advances the plan ordinal, never reuses
    # a completed ID. An explicit reset instead returns to the baseline.
    next_plan = fleet.trucks[0].plan
    await simulator.apply_control(scenario=SimulationScenario.HAUL)
    assert simulator._haul.production.trucks[0].plan == next_plan
    assert simulator.analytics.get_trip_history(200).total_trips == 121
    await simulator.reset()
    assert simulator.analytics.get_trip_history(200) == initial_history
    assert simulator._haul.production.trucks[0].plan.payload_tonnes == target
