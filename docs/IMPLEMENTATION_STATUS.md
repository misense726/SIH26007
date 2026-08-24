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
