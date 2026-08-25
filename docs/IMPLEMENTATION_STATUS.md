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

## M3: driver dashboard base

Status: complete and launch-verified on 2026-08-24.

Implemented:

- camera-first driver layout with an honest unavailable state;
- visibility-responsive synthetic road and corridor overlay;
- vehicle-centred 360-degree ToF proximity widget;
- speed, heading, nearest obstacle, visibility, corridor, and stop-state instruments;
- route guidance that never tells the driver to proceed while the corridor is grey or red;
- responsive mobile layout.

## M4: supervisor dashboard base

Status: complete and launch-verified on 2026-08-24.

Implemented:

- shared fleet map from the canonical world state;
- one card per vehicle from the fleet-ready pose list;
- x/y, heading, speed, approximate relative altitude, pressure, temperature, visibility, obstacle distance, emergency state, and sensor health;
- fleet summary and safety alert log;
- separate information density from the driver view.

Verification:

- backend: 9 tests passed, including a multiple-dumper contract test;
- frontend: 5 tests passed, including primary-vehicle selection and ToF projection;
- TypeScript and Vite production build passed;
- browser checks passed for driver, supervisor, and 390-pixel mobile layouts;
- visible-copy audit found no implementation notes or em dashes.

## Wired three-controller firmware

Status: compile-verified on 2026-08-24; physical bench verification pending.

Implemented:

- MAIN firmware for a normal ESP32 DevKit/WROOM target;
- FRONT and REAR firmware for XIAO ESP32-C6 targets;
- two independent 115200-baud hardware UART links with 500 ms stale detection;
- sequential TCA9548A ToF acquisition and discrete servo scans;
- MPU6050, BMP280, Hall odometry, local safety state machine, and relay cut;
- missing-sensor retries, bounded parsers, health masks, and unknown-range
  handling;
- wired USB laptop parser, command sender, and serial monitor;
- no wireless or cloud dependency;
- removal of the legacy `firmware/esp32` project.

Verification:

- MAIN: 328,380 bytes flash, 35,612 bytes globals, no compiler warnings;
- FRONT: 309,618 bytes flash, 15,860 bytes globals;
- REAR: 309,626 bytes flash, 15,860 bytes globals;
- 19 firmware and wired protocol contract tests passed;
- the three compile targets pass through `scripts/verify-firmware.ps1`.

The current machine had no USB-connected ESP32 boards. Upload, live UART,
sensor, servo, Hall, relay, and prolonged power tests remain on the bench
checklist in `firmware/README.md`.

## Deterministic demo and Docker stack

Status: complete and launch-verified on 2026-08-25.

Implemented:

- the running API now uses the provider-driven `FullSimulator`;
- NORMAL, FOG, OBSTACLE, and EMERGENCY scenario controls;
- six bounded, staggered ToF readings derived from route and obstacle geometry;
- coherent Hall, IMU, scheduled ArUco, BMP280, visibility, occupancy, corridor,
  alert, and emergency-stop simulation values;
- typed simulation control endpoints and responsive dashboard controls;
- a two-container Docker Compose stack with FastAPI, nginx, health checks, and
  same-origin HTTP and WebSocket proxying.

Verification:

- backend: 37 tests passed, including deterministic multi-tick and full-route
  invariants;
- frontend: 9 tests passed;
- TypeScript and Vite production build passed;
- Docker Compose configuration validation and image builds passed;
- the backend and frontend containers reached healthy status;
- `/api/health`, simulation controls, and live WebSocket updates passed through
  the nginx service on port 8080;
- all four scenarios returned bounded values, six healthy range channels, and
  coherent visibility, corridor, and emergency states;
- browser checks passed for the driver and supervisor views with no console
  warnings or errors.

Physical firmware validation remains separate from this simulated demo.
