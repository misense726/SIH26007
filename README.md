# FogSen

FogSen is a proof of concept for mine-vehicle operation in fog and low visibility. It builds one backend-owned world model from vehicle pose, range sensing, environment data, and safety state. The driver and supervisor interfaces render that same state.

The dashboard starts in `SIMULATED` mode. The repository also includes
compile-verified wired firmware for MAIN, FRONT, and REAR plus a laptop serial
monitor. It does not claim that prototype ToF sensors are industrial LiDAR,
that BMP280 produces precise altitude, or that a relay motor cut is production
braking.

## What runs now

The simulated foundation includes:

- FastAPI health, status, and world-state endpoints;
- a WebSocket telemetry stream;
- strict Pydantic telemetry contracts;
- configuration for the vehicle, six ToFs, calibration, safety, and the demo;
- provider interfaces for simulated, replay, and future live hardware;
- a React and TypeScript dashboard connected to backend telemetry;
- a manually defined semantic mine route with a moving dumper;
- a camera-first driver dashboard with Auto, Camera, and calibrated ToF spatial views;
- saved light and dark themes with neutral surfaces and safety-only status colors;
- a separate supervisor fleet map with environment, sensor health, and alerts;
- deterministic normal, fog, obstacle, and emergency scenarios with bounded sensor values;
- backend and frontend tests;
- wired firmware for one ESP32 DevKit and two XIAO ESP32-C6 nodes;
- a validated MAIN-to-laptop USB serial protocol with no wireless dependency.

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the milestone record.

## Requirements

- Python 3.11 or newer;
- Node.js 20 or newer;
- npm 10 or newer.

Docker Desktop is optional. When available, Docker Compose runs the backend and
production frontend without installing Python or Node dependencies on the host.

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
- `ws://127.0.0.1:8000/ws/telemetry`
- `http://127.0.0.1:8000/docs`

## Wired firmware

Set up and compile all three controllers:

```powershell
.\scripts\setup-firmware.ps1
.\scripts\verify-firmware.ps1
```

After flashing MAIN and connecting its USB cable, validate live packets without
starting the dashboard:

```powershell
.\.venv\Scripts\python.exe -m pip install pyserial
.\.venv\Scripts\python.exe -m backend.app.serial_monitor --port COM8 --send STATUS
```

Replace `COM8` with the port shown by `arduino-cli board list`. Full wiring,
power, upload, and bench-test instructions are in `firmware/README.md`.

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
config/      Vehicle, sensors, safety thresholds, and demo settings
docs/        Architecture, contracts, hardware, calibration, and demo notes
firmware/    MAIN, FRONT, and REAR wired ESP32 firmware and build notes
frontend/    Driver and supervisor React application
maps/        Saved reference twins
recordings/  JSONL record and replay files
scripts/     Local launch and validation helpers
```

Read `PROJECT_CONTEXT.md` before changing the frozen V1 architecture. Contributors and coding agents must also follow `AGENTS.md`.
