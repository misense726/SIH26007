"""Supervise MI Sense's continuous H.264 camera stream on the Raspberry Pi."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import shutil
import signal
import subprocess
import threading
import time


BIND_HOST = os.getenv("FOGSEN_CAMERA_BIND_HOST", "0.0.0.0").strip()
PORT = int(os.getenv("FOGSEN_CAMERA_PORT", "8888"))
WIDTH = int(os.getenv("FOGSEN_CAMERA_WIDTH", "1296"))
HEIGHT = int(os.getenv("FOGSEN_CAMERA_HEIGHT", "972"))
FPS = int(os.getenv("FOGSEN_CAMERA_FPS", "30"))
BITRATE = int(os.getenv("FOGSEN_CAMERA_BITRATE", "8000000"))
DENOISE = os.getenv("FOGSEN_CAMERA_DENOISE", "cdn_off").strip().lower()
RESTART_MIN_SECONDS = float(os.getenv("FOGSEN_CAMERA_RESTART_MIN_SECONDS", "1"))
RESTART_MAX_SECONDS = float(os.getenv("FOGSEN_CAMERA_RESTART_MAX_SECONDS", "30"))
STABLE_RUN_SECONDS = float(os.getenv("FOGSEN_CAMERA_STABLE_RUN_SECONDS", "30"))

STOP = threading.Event()
ACTIVE_PROCESS: subprocess.Popen[bytes] | None = None


def log(event: str, **fields: object) -> None:
    print(
        json.dumps(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event": event,
                **fields,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        flush=True,
    )


def find_camera() -> str:
    configured = os.getenv("FOGSEN_CAMERA_COMMAND", "").strip()
    if configured:
        resolved = shutil.which(configured)
        if not resolved:
            raise RuntimeError(f"Configured camera command is unavailable: {configured}")
        return resolved
    for candidate in ("rpicam-vid", "libcamera-vid", "raspivid"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError("rpicam-vid, libcamera-vid, or raspivid is required")


def stream_url() -> str:
    return f"tcp://{BIND_HOST}:{PORT}"


def build_camera_command(camera: str) -> list[str]:
    output = stream_url()
    if os.path.basename(camera) == "raspivid":
        return [
            camera,
            "-n",
            "-ih",
            "-pf",
            "high",
            "-fps",
            str(FPS),
            "-w",
            str(WIDTH),
            "-h",
            str(HEIGHT),
            "-b",
            str(BITRATE),
            "-g",
            str(max(1, FPS)),
            "-t",
            "0",
            "-l",
            "-o",
            output,
        ]
    return [
        camera,
        "--nopreview",
        "--codec",
        "h264",
        "--inline",
        "--flush",
        "--profile",
        "high",
        "--framerate",
        str(FPS),
        "--width",
        str(WIDTH),
        "--height",
        str(HEIGHT),
        "--bitrate",
        str(BITRATE),
        "--denoise",
        DENOISE,
        "--intra",
        str(max(1, FPS)),
        "--timeout",
        "0",
        "--listen",
        "--output",
        output,
    ]


def validate_configuration() -> None:
    if not BIND_HOST or any(character.isspace() for character in BIND_HOST):
        raise RuntimeError("FOGSEN_CAMERA_BIND_HOST is invalid")
    if not 1 <= PORT <= 65535:
        raise RuntimeError("FOGSEN_CAMERA_PORT must be in the range 1..65535")
    if WIDTH <= 0 or HEIGHT <= 0 or not 1 <= FPS <= 30:
        raise RuntimeError("Camera resolution/FPS configuration is invalid")
    if BITRATE < 250_000:
        raise RuntimeError("FOGSEN_CAMERA_BITRATE must be at least 250000")
    if DENOISE not in {"auto", "off", "cdn_off", "cdn_fast", "cdn_hq"}:
        raise RuntimeError("FOGSEN_CAMERA_DENOISE is invalid")
    if not 0.1 <= RESTART_MIN_SECONDS <= RESTART_MAX_SECONDS <= 300:
        raise RuntimeError("Camera restart backoff configuration is invalid")
    if STABLE_RUN_SECONDS < 1:
        raise RuntimeError("FOGSEN_CAMERA_STABLE_RUN_SECONDS must be positive")


def request_stop(signum: int, _frame: object) -> None:
    STOP.set()
    process = ACTIVE_PROCESS
    log("shutdown_requested", signal=signum, camera_pid=process.pid if process else None)
    if process and process.poll() is None:
        process.terminate()


def supervise() -> None:
    global ACTIVE_PROCESS

    validate_configuration()
    camera = find_camera()
    command = build_camera_command(camera)
    backoff = RESTART_MIN_SECONDS
    restart_count = 0
    log(
        "camera_supervisor_started",
        camera=camera,
        bind=stream_url(),
        width=WIDTH,
        height=HEIGHT,
        fps=FPS,
        bitrate=BITRATE,
        transport="wifi-tcp",
    )

    while not STOP.is_set():
        started = time.monotonic()
        restart_count += 1
        try:
            ACTIVE_PROCESS = subprocess.Popen(command)
            log("camera_stream_started", camera_pid=ACTIVE_PROCESS.pid, attempt=restart_count)
            return_code = ACTIVE_PROCESS.wait()
        except OSError as exc:
            return_code = None
            log("camera_start_failed", error=f"{type(exc).__name__}: {exc}")
        finally:
            ACTIVE_PROCESS = None

        run_seconds = time.monotonic() - started
        if STOP.is_set():
            break
        if run_seconds >= STABLE_RUN_SECONDS:
            delay = RESTART_MIN_SECONDS
            backoff = RESTART_MIN_SECONDS
        else:
            delay = backoff
            backoff = min(RESTART_MAX_SECONDS, backoff * 2)
        log(
            "camera_stream_stopped",
            return_code=return_code,
            run_seconds=round(run_seconds, 3),
            restart_in_seconds=round(delay, 3),
        )
        if STOP.wait(delay):
            break

    log("camera_supervisor_stopped")


def main() -> None:
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    supervise()


if __name__ == "__main__":
    main()
