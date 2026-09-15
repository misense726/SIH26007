"""Export backend-owned haul telemetry for static, read-only browser playback.

Run ``python -m scripts.export_demo`` before the frontend build. Chunks contain
one full WorldState without reference_map, then shallow top-level replacements.
The browser attaches manifest.reference_map and displays one frame every 100 ms.
No hardware, API server, background simulator task, or real-time sleeps are used.
"""
from __future__ import annotations

import argparse
import asyncio
from copy import deepcopy
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
from tempfile import TemporaryDirectory
import time
from typing import Any
from unittest.mock import patch
from uuid import UUID

from backend.app.analytics.trip_logger import HaulageAnalyticsEngine
from backend.app.config import PROJECT_ROOT, RuntimeSettings, load_project_config
from backend.app.models import DataMode, SimulationScenario
from backend.app.sensor_settings import SensorSettingsStore
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore

TICK_HZ = 10
SAMPLE_EVERY_TICKS = 2
FRAMES_PER_CHUNK = 25
FRAME_INTERVAL_MS = 100  # Five simulated Hz played at twice recorded speed.
DEFAULT_MAX_SECONDS = 1200
# Fixed epoch and gzip mtime make identical source/config produce identical URLs.
START_TIMESTAMP_MS = 1_783_036_800_000


def round_floats(value: Any) -> Any:
    """Keep integer millisecond timestamps intact while quantizing geometry."""
    if isinstance(value, float):
        return round(value, 3)
    if isinstance(value, dict):
        rounded = {key: round_floats(item) for key, item in value.items()}
        # A valid heading just below north can round up to the excluded 360 bound.
        if rounded.get("heading_deg") == 360.0:
            rounded["heading_deg"] = 0.0
        return rounded
    if isinstance(value, list):
        return [round_floats(item) for item in value]
    return value


def encode_json(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8")


def delta_frame(previous: dict | None, current: dict) -> dict:
    """Nested objects and arrays replace wholesale, including null/empty values."""
    if previous is None:
        return current
    return {key: value for key, value in current.items() if key not in previous or previous[key] != value}


def write_chunk(output: Path, frames: list[dict]) -> dict:
    compressed = gzip.compress(encode_json(frames), compresslevel=9, mtime=0)
    name = f"{hashlib.sha256(compressed).hexdigest()}.json.gz"
    (output / name).write_bytes(compressed)
    return {"url": f"/demo/{name}", "frames": len(frames)}


def write_analytics(output: Path, analytics: HaulageAnalyticsEngine, fleet_size: int) -> dict:
    """Write small API-shaped SIMULATED fixtures independently of world chunks."""
    history = analytics.get_trip_history(limit=200).model_dump(mode="json")
    metrics = analytics.get_haulage_metrics(active_fleet_count=fleet_size).model_dump(mode="json")
    output.mkdir(parents=True, exist_ok=True)
    for name, value in (("trip-history.json", history), ("haulage-metrics.json", metrics)):
        (output / name).write_bytes(encode_json(value))
    return {"trips": history["total_trips"], "vehicles": fleet_size}


def export_analytics(output: Path, *, config: dict | None = None) -> dict:
    """Refresh only analytics; do not regenerate or replace the map/recording."""
    config = config if config is not None else load_project_config(RuntimeSettings())
    fleet_size = config["demo"]["demo"]["haul"].get("fleet_size", 8)
    analytics = HaulageAnalyticsEngine(baseline_end_ms=START_TIMESTAMP_MS, fleet_size=fleet_size)
    return write_analytics(Path(output), analytics, fleet_size)


async def export_demo(
    output: Path,
    *,
    config: dict | None = None,
    max_seconds: float = DEFAULT_MAX_SECONDS,
) -> dict:
    """Record exactly the first haul cycle or fail without publishing a manifest.

    This standalone offline process patches the clock so all backend default
    timestamps, V2X expiry and simulator readings share simulated time. Do not
    invoke it inside a running server. Memory retains only one five-second chunk.
    """
    if not math.isfinite(max_seconds) or not 0 < max_seconds <= 3600:
        raise ValueError("max_seconds must be finite and between 0 and 3600")
    config = deepcopy(config) if config is not None else load_project_config(RuntimeSettings())
    demo = config["demo"]["demo"]
    demo["default_scenario"] = SimulationScenario.HAUL.value
    demo["default_speed_scale"] = 1.0
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    clock_ms = START_TIMESTAMP_MS
    chunks: list[dict] = []
    frames: list[dict] = []
    previous = None
    reference_map = None
    frame_count = 0
    first_timestamp = None
    last_timestamp = None
    stages: set[str] = set()

    # Stage files on the same filesystem; incomplete runs never replace the manifest.
    with TemporaryDirectory(prefix=".demo-export-", dir=output) as temporary:
        staging = Path(temporary)
        settings = round_floats(SensorSettingsStore(config, staging / "defaults.json").snapshot().model_dump(mode="json"))
        identifiers = random.Random(0)
        with (
            patch("time.time_ns", side_effect=lambda: clock_ms * 1_000_000),
            patch("uuid.uuid4", side_effect=lambda: UUID(int=identifiers.getrandbits(128), version=4)),
        ):
            simulator = FullSimulator(WorldStore(), config, telemetry_hz=TICK_HZ)
            write_analytics(staging, simulator.analytics, simulator.active_fleet_count)
            for tick in range(1, math.floor(max_seconds * TICK_HZ) + 1):
                clock_ms = START_TIMESTAMP_MS + tick * 100
                world = await simulator.tick()
                if world.mode is not DataMode.SIMULATED or world.haul_route is None:
                    raise RuntimeError("Demo export requires SIMULATED haul telemetry")
                if world.haul_route.cycle > 1:
                    duration_ms = (tick - 1) * 100
                    break
                if (tick - 1) % SAMPLE_EVERY_TICKS:
                    continue
                if reference_map is None:
                    reference_map = round_floats(world.reference_map.model_dump(mode="json"))
                current = round_floats(world.model_dump(mode="json", exclude={"reference_map"}))
                frames.append(delta_frame(previous, current))
                previous = current
                frame_count += 1
                first_timestamp = first_timestamp or world.generated_at_ms
                last_timestamp = world.generated_at_ms
                stages.add(world.haul_route.next_instruction)
                if len(frames) == FRAMES_PER_CHUNK:
                    chunks.append(write_chunk(staging, frames))
                    frames = []
                    previous = None
            else:
                raise RuntimeError(f"Haul cycle did not complete within {max_seconds:g} simulated seconds")

        if frames:
            chunks.append(write_chunk(staging, frames))
        manifest = {
            "version": 1,
            "mode": "SIMULATED",
            "scenario": "HAUL",
            "encoding": "gzip-json-top-level-delta",
            "frame_interval_ms": FRAME_INTERVAL_MS,
            "sample_interval_ms": 200,
            "playback_speed": 2,
            "loop": True,
            "total_frames": frame_count,
            "simulation_duration_ms": duration_ms,
            "playback_duration_ms": frame_count * FRAME_INTERVAL_MS,
            "first_timestamp_ms": first_timestamp,
            "last_timestamp_ms": last_timestamp,
            "chunks": chunks,
            "reference_map": reference_map,
            "settings": settings,
            "encounter_stages": sorted(stages),
            "compressed_bytes": sum((staging / Path(chunk["url"]).name).stat().st_size for chunk in chunks),
        }
        (staging / "sensor-settings.json").write_bytes(encode_json(settings))
        (staging / "manifest.json").write_bytes(encode_json(manifest))
        for chunk in chunks:
            name = Path(chunk["url"]).name
            (staging / name).replace(output / name)
        for name in ("sensor-settings.json", "trip-history.json", "haulage-metrics.json"):
            (staging / name).replace(output / name)
        (staging / "manifest.json").replace(output / "manifest.json")
        # Keep old hashed chunks for any client still holding the previous manifest.
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "frontend/public/demo")
    parser.add_argument("--max-seconds", type=float, default=DEFAULT_MAX_SECONDS)
    parser.add_argument("--analytics-only", action="store_true", help="Refresh trip history and metrics without world chunks")
    args = parser.parse_args()
    started = time.perf_counter()
    if args.analytics_only:
        print(json.dumps({"output": str(args.output.resolve()), **export_analytics(args.output)}, indent=2))
        return
    manifest = asyncio.run(export_demo(args.output, max_seconds=args.max_seconds))
    print(json.dumps({
        "output": str(args.output.resolve()),
        "chunks": len(manifest["chunks"]),
        "frames": manifest["total_frames"],
        "simulation_seconds": manifest["simulation_duration_ms"] / 1000,
        "playback_seconds": manifest["playback_duration_ms"] / 1000,
        "compressed_bytes": manifest["compressed_bytes"],
        "manifest_bytes": (args.output / "manifest.json").stat().st_size,
        "export_seconds": round(time.perf_counter() - started, 2),
    }, indent=2))


if __name__ == "__main__":
    main()
