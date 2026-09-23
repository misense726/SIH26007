from __future__ import annotations

import asyncio
from copy import deepcopy
import gzip
import hashlib
import json
from pathlib import Path
import tomllib

import pytest

from backend.app.config import PROJECT_ROOT, RuntimeSettings, load_project_config
from backend.app.models import DataMode, VehiclePose, WorldState
from backend.app.sensor_settings import SensorSettingsState
from backend.app.simulation.engine import FullSimulator
from scripts.export_demo import (
    DEMO_V2X_HISTORY_LIMIT,
    FRAMES_PER_CHUNK,
    START_TIMESTAMP_MS,
    delta_frame,
    encode_json,
    export_demo,
    export_analytics,
    round_floats,
)
from scripts.prepare_vercel_demo import prepare


def digest(frame: dict) -> str:
    return hashlib.sha256(json.dumps(frame, sort_keys=True).encode()).hexdigest()


@pytest.fixture(scope="module")
def recording(tmp_path_factory):
    output = tmp_path_factory.mktemp("demo")
    expected = []
    original_tick = FullSimulator.tick

    async def observed_tick(self):
        world = await original_tick(self)
        if world.haul_route.cycle == 1:
            frame = round_floats(world.model_dump(mode="json"))
            frame["v2x"]["recent_messages"] = frame["v2x"]["recent_messages"][-DEMO_V2X_HISTORY_LIMIT:]
            expected.append(digest(frame))
        return world

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(FullSimulator, "tick", observed_tick)
        # Ambient LIVE settings must not start hardware or alter this recording.
        monkeypatch.setenv("FOGSEN_MODE", "LIVE")
        monkeypatch.setenv("FOGSEN_CONFIG_DIR", "does-not-exist")
        manifest = asyncio.run(export_demo(output))
    return output, manifest, expected


def reconstructed(output, manifest):
    for chunk in manifest["chunks"]:
        compressed = (output / Path(chunk["url"]).name).read_bytes()
        assert chunk["url"] == f"/demo/{hashlib.sha256(compressed).hexdigest()}.json.gz"
        deltas = json.loads(gzip.decompress(compressed))
        assert len(deltas) == chunk["frames"]
        assert 0 < len(deltas) <= FRAMES_PER_CHUNK
        assert set(deltas[0]) == set(WorldState.model_fields) - {"reference_map"}
        previous = {}
        for index, delta in enumerate(deltas):
            assert "reference_map" not in delta
            if index:
                assert "mode" not in delta
                assert all(previous.get(key) != value for key, value in delta.items())
            previous = {**previous, **delta}
            yield {**previous, "reference_map": manifest["reference_map"]}


def test_full_cycle_roundtrip_matches_backend_frames(recording):
    output, manifest, expected = recording
    assert json.loads((output / "manifest.json").read_bytes()) == manifest
    assert manifest["version"] == 1
    assert manifest["loop"] is True
    assert manifest["frame_interval_ms"] == 100
    assert manifest["sample_interval_ms"] == 200
    assert manifest["playback_speed"] == 2
    assert manifest["total_frames"] == sum(chunk["frames"] for chunk in manifest["chunks"])
    assert manifest["playback_duration_ms"] == manifest["total_frames"] * 100
    assert manifest["compressed_bytes"] == sum(
        (output / Path(chunk["url"]).name).stat().st_size for chunk in manifest["chunks"]
    )
    actual = []
    timestamps = []
    phases = set()
    destinations = set()
    encounters = set()
    lead_waiting_frames = 0
    lead_moving_frames = 0
    for frame in reconstructed(output, manifest):
        actual.append(digest(frame))
        world = WorldState.model_validate(frame)
        assert world.mode is DataMode.SIMULATED
        assert world.simulation.scenario == "HAUL"
        assert all(vehicle.mode is DataMode.SIMULATED for vehicle in world.vehicles)
        assert all(reading.mode is DataMode.SIMULATED for reading in world.ranges)
        assert world.camera.mode is DataMode.SIMULATED
        assert world.environment.mode is DataMode.SIMULATED
        assert world.haul_route.cycle == 1
        assert len(world.vehicles) == 8
        assert len(world.spatial_points) <= 600
        assert len(world.occupancy.occupied_cells) <= 420
        assert len(world.alerts) <= 60
        assert len(world.v2x.recent_messages) <= DEMO_V2X_HISTORY_LIMIT
        timestamps.append(world.generated_at_ms)
        phases.add(world.haul_route.phase)
        destinations.add(world.haul_route.destination)
        encounters.add(world.haul_route.next_instruction)
        lead_waiting_frames += int(world.haul_route.lead_waiting)
        lead_moving_frames += int(world.vehicles[2].speed_mps > 0)
    assert lead_waiting_frames == 0
    assert lead_moving_frames > 0
    assert actual == expected
    assert len(actual) == manifest["total_frames"]
    assert timestamps[0] == START_TIMESTAMP_MS + 200 == manifest["first_timestamp_ms"]
    assert timestamps[-1] == manifest["last_timestamp_ms"]
    assert all(second - first == 200 for first, second in zip(timestamps, timestamps[1:]))
    assert manifest["simulation_duration_ms"] <= 1_200_000
    assert {"HAULING", "ARRIVED"} <= phases
    assert destinations == {"Dump point", "Mine loading bay"}
    assert {
        "Loading iron ore at pit floor",
        "Climbing to the crusher",
        "Reversing into tipping bay",
        "Tipping iron ore into crusher",
        "Lowering empty bed",
        "Returning empty to pit floor",
    } <= encounters
    assert sorted(encounters) == manifest["encounter_stages"]
    settings = json.loads((output / "sensor-settings.json").read_bytes())
    assert settings == manifest["settings"]
    assert len(SensorSettingsState.model_validate(settings).sensors) == 5


def test_export_is_repeatable_and_does_not_mutate_config(recording, tmp_path):
    original_output, manifest, _ = recording
    config = load_project_config(RuntimeSettings())
    before = deepcopy(config)
    repeated = asyncio.run(export_demo(tmp_path, config=config))
    assert config == before
    assert repeated == manifest
    for name in ("trip-history.json", "haulage-metrics.json"):
        assert (tmp_path / name).read_bytes() == (original_output / name).read_bytes()


def test_static_analytics_match_initial_recorded_fleet(recording):
    output, manifest, _ = recording
    history = json.loads((output / "trip-history.json").read_bytes())
    metrics = json.loads((output / "haulage-metrics.json").read_bytes())
    first = next(reconstructed(output, manifest))
    assert history["total_trips"] == metrics["total_completed_cycles"] == 120
    assert metrics["active_fleet_count"] == 8
    assert history["total_tonnes"] == metrics["total_ore_moved_tonnes"]
    assert first["operations"]["analytics_summary"]["total_completed_cycles"] == 120
    for index in range(8):
        vehicle_id = f"DUMPER_{index + 1:02d}"
        trips = [trip for trip in history["trips"] if trip["vehicle_id"] == vehicle_id]
        assert len(trips) == 15
        assert all(trip["source"] == "SIMULATED" for trip in trips)
        assert len({f'{trip["payload_tonnes"] * trip["distance_km"] / trip["fuel_litres_est"]:.2f}'
                    for trip in trips}) == 15


def test_analytics_only_export_leaves_recording_files_untouched(tmp_path):
    sentinel = tmp_path / "manifest.json"
    sentinel.write_bytes(b"existing world recording")
    result = export_analytics(tmp_path)
    assert result == {"trips": 120, "vehicles": 8}
    assert sentinel.read_bytes() == b"existing world recording"
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "haulage-metrics.json", "manifest.json", "trip-history.json",
    ]
    original = (tmp_path / "trip-history.json").read_bytes()
    export_analytics(tmp_path)
    assert (tmp_path / "trip-history.json").read_bytes() == original


@pytest.mark.asyncio
async def test_incomplete_cycle_does_not_publish_or_replace_manifest(tmp_path):
    old = b'{"previous":"recording"}'
    (tmp_path / "manifest.json").write_bytes(old)
    with pytest.raises(RuntimeError, match="did not complete"):
        await export_demo(tmp_path, max_seconds=0.3)
    assert (tmp_path / "manifest.json").read_bytes() == old
    assert sorted(path.name for path in tmp_path.iterdir()) == ["manifest.json"]


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, -1, 3601, float("inf"), float("nan")])
async def test_invalid_limit_is_rejected(tmp_path, limit):
    with pytest.raises(ValueError, match="max_seconds"):
        await export_demo(tmp_path, max_seconds=limit)
    assert not list(tmp_path.iterdir())


def test_quantization_keeps_north_heading_inside_telemetry_bounds():
    pose = VehiclePose(heading_deg=359.9998)
    rounded = round_floats({"vehicles": [pose.model_dump(mode="json")]})
    restored = VehiclePose.model_validate(rounded["vehicles"][0])
    assert restored.heading_deg == 0.0
    assert round_floats({"heading_deg": 359.9988})["heading_deg"] == 359.999


def test_quantization_and_shallow_delta_preserve_null_empty_and_timestamps():
    current = {"generated_at_ms": 1_783_036_800_123, "object": None, "array": [], "pose": {"x": 1.23456}}
    rounded = round_floats(current)
    assert rounded["generated_at_ms"] == current["generated_at_ms"]
    assert rounded["pose"] == {"x": 1.235}
    previous = {**rounded, "object": {"id": 1}, "array": [1], "pose": {"x": 1}}
    delta = delta_frame(previous, rounded)
    assert "generated_at_ms" not in delta
    assert delta == {"object": None, "array": [], "pose": {"x": 1.235}}
    assert {**previous, **delta} == rounded
    assert delta_frame(None, rounded) == rounded
    with pytest.raises(ValueError):
        encode_json({"invalid": float("nan")})


def test_vercel_only_publishes_static_output():
    vercel = json.loads((PROJECT_ROOT / "vercel.json").read_text())
    assert vercel["framework"] is None
    assert vercel["outputDirectory"] == "frontend/dist"
    assert "python -m scripts.export_demo" in vercel["buildCommand"]
    assert "functions" not in vercel
    assert "rewrites" not in vercel
    ignore = (PROJECT_ROOT / ".vercelignore").read_text().splitlines()
    assert "api" in ignore
    assert not {"backend", "config", "maps", "scripts"}.intersection(ignore)
    project = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text())
    assert "vercel" not in project["tool"]
    headers = {rule["source"]: {item["key"]: item["value"] for item in rule["headers"]} for rule in vercel["headers"]}
    assert "immutable" in headers["/demo/:chunk.json.gz"]["Cache-Control"]
    # Browser DecompressionStream consumes the bytes, not HTTP Content-Encoding.
    assert "Content-Encoding" not in headers["/demo/:chunk.json.gz"]
    assert headers["/demo/manifest.json"]["Cache-Control"] == "no-cache"
    assert headers["/demo/sensor-settings.json"]["Cache-Control"] == "no-cache"


def test_prebuilt_vercel_upload_keeps_only_current_chunks(tmp_path):
    demo = tmp_path / "demo"
    demo.mkdir()
    current = f"{'a' * 64}.json.gz"
    old = f"{'b' * 64}.json.gz"
    (demo / current).write_bytes(b"current")
    (demo / old).write_bytes(b"old")
    (demo / "manifest.json").write_text(json.dumps({
        "mode": "SIMULATED", "scenario": "HAUL",
        "chunks": [{"url": f"/demo/{current}", "frames": 1}],
        "compressed_bytes": 7,
    }))

    assert prepare(tmp_path) == {"chunks": 1, "removed_old_chunks": 1, "compressed_bytes": 7}
    assert (demo / current).read_bytes() == b"current"
    assert not (demo / old).exists()
    deployed_config = json.loads((tmp_path / "vercel.json").read_text())
    assert deployed_config["framework"] is None
    assert "buildCommand" not in deployed_config
    assert "installCommand" not in deployed_config
    assert "outputDirectory" not in deployed_config
    assert deployed_config["headers"] == json.loads((PROJECT_ROOT / "vercel.json").read_text())["headers"]
