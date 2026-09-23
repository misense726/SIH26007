"""Check MI Sense live telemetry and Pi camera boundaries."""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Sequence
from urllib.error import URLError
from urllib.request import urlopen


def _get(base_url: str, path: str) -> dict[str, object]:
    with urlopen(f"{base_url.rstrip('/')}{path}", timeout=5) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} did not return a JSON object")
    return payload


def _arguments() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check MI Sense MAIN telemetry and Pi camera status."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--stale-ms", type=int, default=1_500)
    parser.add_argument(
        "--skip-camera",
        action="store_true",
        help=(
            "Validate MAIN telemetry and the five-range contract without "
            "a Pi camera."
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _arguments().parse_args(argv)
    try:
        status = _get(arguments.base_url, "/api/status")
        world = _get(arguments.base_url, "/api/world")
        camera = (
            None
            if arguments.skip_camera
            else _get(arguments.base_url, "/api/camera/status")
        )
    except (OSError, URLError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL MI Sense live API: {exc}")
        return 1

    now_ms = int(time.time() * 1_000)
    last_telemetry_ms = status.get("last_telemetry_ms")
    telemetry_fresh = (
        isinstance(last_telemetry_ms, int)
        and now_ms - last_telemetry_ms <= arguments.stale_ms
    )
    transport = status.get("telemetry_transport")
    active_sources = status.get("active_telemetry_sources")
    required_sources = {"USB", "Wi-Fi"} if transport == "BOTH" else set()
    redundant_sources_ok = not required_sources or (
        isinstance(active_sources, list)
        and required_sources.issubset(set(active_sources))
    )
    source_ok = (
        status.get("mode") == "LIVE"
        and transport in {"SERIAL", "WIFI", "BOTH"}
        and telemetry_fresh
        and redundant_sources_ok
    )
    print(f"{'PASS' if source_ok else 'FAIL'} MAIN live telemetry source")
    print(
        "INFO mode={mode} transport={transport} endpoint={endpoint} "
        "active={active} world_sequence={sequence} telemetry_age_ms={age}".format(
            mode=status.get("mode"),
            transport=transport,
            endpoint=status.get("telemetry_endpoint"),
            active=(
                ",".join(str(source) for source in active_sources)
                if isinstance(active_sources, list)
                else "unknown"
            ),
            sequence=status.get("world_sequence"),
            age=(
                now_ms - last_telemetry_ms
                if isinstance(last_telemetry_ms, int)
                else "unknown"
            ),
        )
    )

    ranges = world.get("ranges")
    if not isinstance(ranges, list):
        print("FAIL five-sensor range list")
        return 1
    print(f"{'PASS' if len(ranges) == 5 else 'FAIL'} five-sensor range list ({len(ranges)})")
    for reading in ranges:
        if not isinstance(reading, dict):
            continue
        sensor_id = reading.get("sensor_id", "unknown")
        if reading.get("is_valid"):
            print(f"INFO {sensor_id}: {reading.get('range_m')} m")
        else:
            print(f"INFO {sensor_id}: unknown (not promoted to max range)")

    if camera is None:
        print("INFO Pi camera check skipped")
        return 0 if source_ok and len(ranges) == 5 else 1

    camera_ok = camera.get("status") == "live" and camera.get("raw_available") is True
    print(f"{'PASS' if camera_ok else 'FAIL'} Pi camera Wi-Fi stream")
    print(
        "INFO camera_status={status} source={source} size={width}x{height} fps={fps}".format(
            status=camera.get("status"),
            source=camera.get("source_uri"),
            width=camera.get("width_px", "unknown"),
            height=camera.get("height_px", "unknown"),
            fps=camera.get("measured_fps", "unknown"),
        )
    )
    return 0 if source_ok and len(ranges) == 5 and camera_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
