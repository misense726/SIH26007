# FogSen

FogSen is a proof of concept for mine-vehicle operation in fog and low visibility. It builds one backend-owned world model from vehicle pose, range sensing, environment data, and safety state. The driver and supervisor interfaces render that same state.

The dashboard starts in `SIMULATED` mode. The repository also includes
compile-verified firmware for BACK/MAIN, FRONT, and MIDDLE, a laptop serial
monitor, and an opt-in `LIVE` runtime that feeds MAIN Wi-Fi or USB telemetry into the
same dashboard state. It does not claim that prototype ToF sensors are industrial LiDAR,
that BMP280 produces precise altitude, or that a relay motor cut is production
braking.

The current `LIVE` hardware profile leaves Hall sensors and the motor-cut relay
unconnected. Their code remains behind disabled flags for a later build. The
deterministic simulator still exercises those future interfaces.

## What runs now

FogSen currently includes:

- FastAPI health, status, and world-state endpoints;
- a WebSocket telemetry stream;
- strict Pydantic telemetry contracts;
- configuration for the vehicle, five ToFs, calibration, safety, and the demo;
- provider interfaces for simulated, wired live, replay, and future hardware;
- a React and TypeScript dashboard connected to backend telemetry;
- a manually defined semantic mine route with a moving dumper;
- a camera-first driver dashboard with Auto, Camera, and calibrated ToF spatial views;
- a Raspberry Pi RGB feed over Wi-Fi with raw and GPU-dehazed driver views;
- saved light and dark themes with neutral surfaces and safety-only status colors;
- a separate supervisor fleet map with environment, sensor health, and alerts;
- deterministic normal, fog, obstacle, and emergency scenarios with bounded sensor values;
- backend and frontend tests;
- wired firmware for one ESP32-WROOM BACK/MAIN, one XIAO ESP32-C6 FRONT, and
  one ESP32-C3 Super Mini MIDDLE controller;
- validated MAIN-to-laptop Wi-Fi telemetry with USB kept as a diagnostic fallback, independent of the camera link.

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the milestone record.

## Requirements

- Python 3.11 or newer;
- Node.js 20 or newer;
- npm 10 or newer.

Docker Desktop is optional. When available, Docker Compose runs the backend and
production frontend without installing Python or Node dependencies on the host.
The DehazeFormer-MCT view uses Docker's NVIDIA runtime and an NVIDIA GPU. Raw
camera video continues if ML enhancement is disabled or unavailable.

Firmware work also requires Arduino CLI. `scripts/setup-firmware.ps1` installs
the pinned ESP32 core and libraries once Arduino CLI is on `PATH`.

No cloud service is required.

## Setup

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
Set-Location frontend
npm install
```

## Run

Start the backend from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
Set-Location frontend
npm run dev
```

Open `http://127.0.0.1:5173`.

## Run with Docker

From the repository root:

```powershell
docker compose up -d --build --wait
```

Open `http://127.0.0.1:8080`. The frontend container proxies `/api` and `/ws` to
the backend container. See [docs/DOCKER.md](docs/DOCKER.md) for health and log
commands.

Backend checks:

- `http://127.0.0.1:8000/api/health`
- `http://127.0.0.1:8000/api/status`
- `http://127.0.0.1:8000/api/world`
- `http://127.0.0.1:8000/api/camera/status`
- `http://127.0.0.1:8000/api/camera/frame?view=raw`
- `http://127.0.0.1:8000/api/camera/frame?view=enhanced`
- `ws://127.0.0.1:8000/ws/telemetry`
- `http://127.0.0.1:8000/docs`

## Raspberry Pi camera over Wi-Fi

The Pi runs `camera/pi_sender/sender.py` through `fogsen-camera.service` and
listens on TCP port 8888. The default Docker configuration connects to
`tcp://10.38.143.254:8888`. Override `FOGSEN_CAMERA_STREAM_URL` when the Pi's
Wi-Fi address changes. USB video and USB-LAN are not used.

The laptop decodes one shared H.264 connection, calculates camera visibility,
and exposes raw and enhanced MJPEG views to every dashboard client. The ML
worker drops old work instead of queuing frames, so the raw feed stays current.
Camera data and enhanced imagery remain driver aids; neither can trigger a
motor cut without the range-sensor safety path.

## Wired firmware

Set up and compile all three controllers:

```powershell
.\scripts\setup-firmware.ps1
.\scripts\verify-firmware.ps1
```

After flashing MAIN, validate the USB fallback without starting the dashboard:

```powershell
.\.venv\Scripts\python.exe -m pip install pyserial
.\.venv\Scripts\python.exe -m backend.app.serial_monitor --port COM11 --send STATUS
```

Replace `COM11` with the port shown by `arduino-cli board list`. Full wiring,
power, upload, and bench-test instructions are in `firmware/README.md`.
The ignored `firmware/main_esp32/wifi_secrets.h` stores the private network
values and backend computer IPv4 address. Do not commit it.

To feed MAIN telemetry into the dashboard, install the hardware dependencies
and start the backend in explicit `LIVE` mode:

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[hardware]"
$env:FOGSEN_MODE = "LIVE"
$env:FOGSEN_TELEMETRY_TRANSPORT = "WIFI"
$env:FOGSEN_WIFI_LISTEN_HOST = "0.0.0.0"
$env:FOGSEN_WIFI_LISTEN_PORT = "8765"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
```

Start the frontend normally in another terminal. `SIMULATED` remains the
default when `FOGSEN_MODE` is not set. In `LIVE` mode, an absent source or stale
MAIN stream publishes five invalid ranges, degraded health, a grey corridor,
and a warning instead of leaving the last healthy state on screen.

## Test

```powershell
.\.venv\Scripts\python.exe -m pytest
Set-Location frontend
npm test
npm run build
```

## Coordinate convention

FogSen uses metres and seconds internally. In the vehicle frame, positive X points right and positive Y points forward. The world frame is fixed local Cartesian. Heading is clockwise from world positive Y.

## Repository layout

```text
backend/     FastAPI, canonical world model, providers, simulation, and tests
camera/      Raspberry Pi Wi-Fi camera sender and systemd unit
config/      Vehicle, sensors, safety thresholds, and demo settings
docs/        Architecture, contracts, hardware, calibration, and demo notes
firmware/    BACK/MAIN, FRONT, and MIDDLE wired ESP32 firmware and build notes
frontend/    Driver and supervisor React application
maps/        Saved reference twins
recordings/  JSONL record and replay files
scripts/     Local launch and validation helpers
```

Read `PROJECT_CONTEXT.md` before changing the frozen V1 architecture. Contributors and coding agents must also follow `AGENTS.md`.
