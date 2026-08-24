# FogSen

FogSen is a proof of concept for mine-vehicle operation in fog and low visibility. It builds one backend-owned world model from vehicle pose, range sensing, environment data, and safety state. The driver and supervisor interfaces render that same state.

The current repository starts in `SIMULATED` mode. It does not claim that prototype ToF sensors are industrial LiDAR, that BMP280 produces precise altitude, or that a relay motor cut is production braking.

## What runs now

The simulated foundation includes:

- FastAPI health, status, and world-state endpoints;
- a WebSocket telemetry stream;
- strict Pydantic telemetry contracts;
- configuration for the vehicle, six ToFs, calibration, safety, and the demo;
- provider interfaces for simulated, replay, and future live hardware;
- a React and TypeScript dashboard connected to backend telemetry;
- a manually defined semantic mine route with a moving dumper;
- a camera-first driver dashboard with synthetic corridor and 360-degree ToF awareness;
- a separate supervisor fleet map with environment, sensor health, and alerts;
- backend and frontend tests.

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the milestone record.

## Requirements

- Python 3.11 or newer;
- Node.js 20 or newer;
- npm 10 or newer.

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

Backend checks:

- `http://127.0.0.1:8000/api/health`
- `http://127.0.0.1:8000/api/status`
- `http://127.0.0.1:8000/api/world`
- `ws://127.0.0.1:8000/ws/telemetry`
- `http://127.0.0.1:8000/docs`

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
firmware/    ESP32 integration, added after the simulated chain is working
frontend/    Driver and supervisor React application
maps/        Saved reference twins
recordings/  JSONL record and replay files
scripts/     Local launch and validation helpers
```

Read `PROJECT_CONTEXT.md` before changing the frozen V1 architecture. Contributors and coding agents must also follow `AGENTS.md`.
