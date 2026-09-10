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
from backend.app.models import DataMode, WorldState
from backend.app.sensor_settings import SensorSettingsState
from backend.app.simulation.engine import FullSimulator
from scripts.export_demo import (
    FRAMES_PER_CHUNK,
    START_TIMESTAMP_MS,
    delta_frame,
    encode_json,
    export_demo,
    round_floats,
)


def digest(frame: dict) -> str:
    return hashlib.sha256(json.dumps(frame, sort_keys=True).encode()).hexdigest()


@pytest.fixture(scope="module")
def recording(tmp_path_factory):
    output = tmp_path_factory.mktemp("demo")
    expected = []
    original_tick = FullSimulator.tick

    async def observed_tick(self):
        world = await original_tick(self)
        if world.haul_route.cycle == 1 and world.sequence % 2:
            expected.append(digest(round_floats(world.model_dump(mode="json"))))
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
        assert len(world.vehicles) == 3
        assert len(world.spatial_points) <= 600
        assert len(world.occupancy.occupied_cells) <= 420
        assert len(world.alerts) <= 60
        timestamps.append(world.generated_at_ms)
        phases.add(world.haul_route.phase)
        destinations.add(world.haul_route.destination)
        encounters.add(world.haul_route.next_instruction)
        lead_waiting_frames += int(world.haul_route.lead_waiting)
        lead_moving_frames += int(world.vehicles[2].speed_mps > 0)
    # Existing backend guidance prioritizes oncoming traffic over lead waiting.
    assert lead_waiting_frames > 0
    assert lead_moving_frames > 0
    assert actual == expected
    assert len(actual) == manifest["total_frames"]
    assert timestamps[0] == START_TIMESTAMP_MS + 100 == manifest["first_timestamp_ms"]
    assert timestamps[-1] == manifest["last_timestamp_ms"]
    assert all(second - first == 200 for first, second in zip(timestamps, timestamps[1:]))
    assert manifest["simulation_duration_ms"] <= 600_000
    assert {"HAULING", "OBSTACLE", "ARRIVED"} <= phases
    assert destinations == {"Dump point", "Mine loading bay"}
    assert {
        "Rock ahead. Passing left slowly",
        "Rock passed. Rejoining track",
        "Oncoming truck. Passing slowly",
        "Unloading at crusher",
        "Loading at mine site",
        "Return to the mine loading bay",
    } <= encounters
    assert sorted(encounters) == manifest["encounter_stages"]
    settings = json.loads((output / "sensor-settings.json").read_bytes())
    assert settings == manifest["settings"]
    assert len(SensorSettingsState.model_validate(settings).sensors) == 5


def test_export_is_repeatable_and_does_not_mutate_config(recording, tmp_path):
    _, manifest, _ = recording
    config = load_project_config(RuntimeSettings())
    before = deepcopy(config)
    repeated = asyncio.run(export_demo(tmp_path, config=config))
    assert config == before
    assert repeated == manifest


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
