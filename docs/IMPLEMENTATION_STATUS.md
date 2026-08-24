# Implementation status

## M0: repository foundation

Status: complete and launch-verified on 2026-08-24.

Implemented:

- standalone Git repository on `main`;
- Python and frontend package definitions;
- configuration loader and calibration files;
- strict normalized telemetry models;
- all required provider interfaces;
- backend-owned world store;
- FastAPI health, status, world, and WebSocket endpoints;
- simulated six-sensor telemetry heartbeat;
- React client with live WebSocket state;
- backend and frontend test harnesses;
- initial architecture, contracts, hardware, calibration, and demo docs.

Verification:

- backend: 4 tests passed;
- frontend: 1 test passed;
- TypeScript and Vite production build passed;
- `/api/health`, `/api/status`, `/api/world`, and `/ws/telemetry` passed;
- browser check showed a connected client, advancing telemetry, and six healthy simulated range sensors.

Current limits:

- the route and semantic twin begin in M1 and M2;
- dashboards are still the foundation view;
- telemetry is simulated;
- no camera frames, hardware serial, relay, occupancy map, or record/replay yet.

## M1: canonical world model

Status: complete and launch-verified on 2026-08-24.

Implemented:

- one backend-owned `WorldState` for the reference map, fleet-ready poses, ranges, environment, live objects, health, safe corridor, emergency state, and spatial points;
- immutable snapshots from the concurrent world store;
- typed semantic map features;
- `GET /api/map` and validated `PUT /api/map`;
- the same world snapshot for HTTP and WebSocket clients.

## M2: base digital twin

Status: complete and launch-verified on 2026-08-24.

Implemented:

- manually defined mine-style route with road, berms, centerline, hazard, speed zone, static obstacle, start, and destination;
- deterministic polyline motion in top-down coordinates;
- documented heading convention;
- live SVG reference-twin renderer with the moving dumper;
- map and route tests.

Verification before launch:

- backend: 8 tests passed;
- frontend: 1 test passed;
- TypeScript and Vite production build passed.

Launch verification:

- the browser received map `FOGSEN_TEST_ROUTE_01` from the WebSocket world snapshot;
- ten semantic features rendered in the top-down twin;
- the simulated dumper moved along the route with live x/y and heading updates;
- the view stayed explicitly labelled `SIMULATED`.
