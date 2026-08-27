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
- simulated range-sensor telemetry heartbeat;
- React client with live WebSocket state;
- backend and frontend test harnesses;
- initial architecture, contracts, hardware, calibration, and demo docs.

Verification:

- backend: 4 tests passed;
- frontend: 1 test passed;
- TypeScript and Vite production build passed;
- `/api/health`, `/api/status`, `/api/world`, and `/ws/telemetry` passed;
- browser check showed a connected client, advancing telemetry, and healthy simulated range sensors.

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
- Auto, Camera, and ToF overlay controls, with Auto adding ToF for `LOW` and
  `VERY_LOW` visibility;
- vehicle-centred 360-degree ToF views drawn from backend-calibrated spatial points;
- speed, heading, nearest obstacle, corridor, and stop-state instruments;
- neutral dark and light themes with green reserved for safe and healthy states;
- responsive mobile layout.

Refined and browser-verified on 2026-08-25:

- Driver and Supervisor views passed in light and dark modes;
- Auto stayed camera-first in `NORMAL` and enabled ToF in `FOG`;
- manual Camera and ToF choices worked without changing backend safety state;
- the Driver choice survived navigation between Driver and Supervisor;
- the 390-pixel layouts had no horizontal overflow;
- 19 frontend tests and the TypeScript and Vite production build passed;
- the browser console had no warnings or errors.

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

## Final wired three-controller firmware

Status: compile-verified on 2026-08-28; physical bench verification pending.

Implemented:

- BACK/MAIN firmware for a normal ESP32 DevKit/WROOM target;
- FRONT firmware for XIAO ESP32-C6 and MIDDLE firmware for ESP32-C3 Super Mini;
- five ToFs on three direct, controller-local I2C buses with a dedicated XSHUT GPIO
  for every sensor;
- ordered shutdown, default-address initialization, runtime addressing, address
  probing, and complete node-local recovery;
- two independent 115200-baud hardware UART links with 500 ms stale detection;
- sequential local ToF acquisition with configurable guards and independent
  front and rear servo scans;
- per-sensor sample times converted by MAIN into host-relative ages;
- exact FRONT and MIDDLE UART masks plus the composite rear health mask;
- MPU6050, BMP280, and the local safety state machine;
- dormant Hall odometry and relay-cut implementations behind disabled hardware
  profile flags;
- unknown-range handling with no maximum-range substitution;
- wired USB diagnostic and fallback protocol, command sender, and serial monitor;
- MAIN Wi-Fi TCP telemetry to the laptop while both sensor-node links remain
  wired UART;
- no cloud dependency.

Verification:

- MAIN: 966,003 bytes flash and 60,004 bytes globals;
- FRONT: 310,802 bytes flash and 15,876 bytes globals;
- MIDDLE: 317,042 bytes flash and 14,232 bytes globals;
- 35 firmware and wired protocol contract tests passed;
- all three targets compiled with warnings enabled through
  `scripts/verify-firmware.ps1`.

Arduino CLI did not identify an attached ESP32 target, and no upload was
performed. Live XSHUT and address recovery, optical interference, servo, UART
endurance, and power tests remain on the bench checklist in
`firmware/README.md`. Hall and relay bench tests apply only after enabling that
future hardware profile.

## Five-sensor wired sensing-to-dashboard chain

Status: software-verified on 2026-08-27; physical end-to-end verification
pending.

Implemented:

- explicit `FOGSEN_MODE=LIVE` runtime with Wi-Fi TCP telemetry and USB serial fallback;
- MAIN packet ingestion into the canonical backend `WorldStore` used by
  `/api/world` and `/ws/telemetry`;
- five normalized range readings with distinct timestamps and per-sensor
  health;
- fail-closed handling for invalid masks, partial forward coverage, repeated or
  out-of-order packets, controller restart, serial failure, and host-side stale
  timeout;
- five invalid zero-quality readings, stale or offline health, a grey corridor,
  and a warning whenever the live stream cannot verify safety;
- supervisor and driver views that count only the five ToFs and ignore MAIN's
  local MPU6050 and BMP280 health when reporting range coverage;
- saved light and dark dashboard images with the final sensor names and counts.

Verification:

- backend: 50 tests passed, including fake-serial packet to API and WebSocket,
  host stale timeout, serial-open failure, duplicate rejection, and controller
  restart;
- frontend: 21 tests passed and the TypeScript/Vite production build passed;
- browser checks showed five named ToFs, `5/5` health, Auto low-visibility ToF
  activation, neutral light and dark themes, and no console warnings or errors.

The software tests use a fake serial reader. They do not prove a physical MAIN
packet reached the dashboard. Camera, ArUco absolute localization, and radar are
not part of this serial runtime. Without an absolute pose source, `LIVE`
position confidence stays zero and the live corridor remains grey.

## Deterministic demo and Docker stack

Status: complete and launch-verified on 2026-08-25.

Implemented:

- the running API now uses the provider-driven `FullSimulator`;
- NORMAL, FOG, OBSTACLE, and EMERGENCY scenario controls;
- five bounded, staggered ToF readings derived from route and obstacle geometry;
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
- all four scenarios returned bounded values, five healthy range channels, and
  coherent visibility, corridor, and emergency states;
- browser checks passed for the driver and supervisor views with no console
  warnings or errors.

Physical firmware validation remains separate from this simulated demo.

## Wi-Fi RGB camera and GPU dehazing

Status: network and software bench-verified on 2026-08-27; physical fog and
vehicle testing pending.

Implemented:

- a project-owned `fogsen-camera.service` on the Raspberry Pi, with the legacy
  camera service left installed but disabled for rollback;
- a 1296×972, 30 FPS, 8 Mbit/s H.264 camera listener over Wi-Fi TCP, with no
  USB video or USB-LAN path;
- one backend camera connection with latest-frame caching, reconnect and stale
  handling, visibility metrics, raw JPEG and MJPEG endpoints, and no queued
  frame backlog;
- checksum-pinned DehazeFormer-MCT source and weights in the backend image;
- CUDA FP16 inference on the laptop GPU, with raw video remaining available if
  model loading or inference fails;
- Raw and Dehazed controls in the driver view, including live resolution,
  frame-rate, latency, model, and transport labels;
- the live camera state in both simulated and serial-backed world snapshots,
  without allowing camera metrics to replace ToF safety evidence.

Verification:

- the Pi service was active and enabled, its H.264 process matched the checked-in
  profile, the Docker connection to port 8888 was established, and the Pi
  reported `throttled=0x0`;
- both Docker containers were healthy and the camera API reported a live
  1296×972 source;
- during concurrent raw ingest and dehazing, the dashboard showed roughly
  25-29 raw FPS and 18-22 enhanced FPS, typically 40-55 ms enhanced-frame latency,
  and 638.3 MB peak GPU memory allocation;
- two-second MJPEG checks received 4.6 MB from the raw stream and 5.0 MB from
  the enhanced stream;
- browser checks passed for Raw and Dehazed views with no console warnings or
  errors;
- 52 backend tests and 21 frontend tests passed, and the frontend production
  build, Python compilation, Compose validation, and diff checks passed.

The current indoor, clear-air image proves Wi-Fi transport, decoding, live
dashboard rendering, and GPU inference. It does not prove dehazing quality in
real fog, long-run Wi-Fi stability, low-light performance, camera thermals, or
vehicle vibration tolerance. Raw and dehazed images remain driver aids and are
not braking ground truth.

## Tactical maps, simulated V2X, and RGB-derived IR

Status: locally integrated and software-verified on 2026-08-28. Radio, thermal
camera, live Pi IR, Docker rebuild, and physical vehicle checks remain pending.

Implemented:

- a circular Leaflet minimap in the driver camera view with primary and peer
  vehicle markers;
- an expanded driver map with satellite, dark, and OpenStreetMap layers;
- a supervisor tactical map with backend schematic and satellite modes,
  multi-truck selection, speed labels, and matching fleet cards;
- a local Cartesian to geodetic display conversion around a configured campus
  anchor without changing the canonical backend `ReferenceMap`;
- `V2XState` in the shared world snapshot plus peer, roadside-unit, advisory,
  packet-log, and link-estimate models;
- V2X state, incoming BSM, and advisory broadcast API endpoints;
- a supervisor V2X monitor with peer, advisory, and packet-log tabs;
- a CPU or CUDA false-color IR worker derived from RGB luminance, with status,
  frame, stream, latency, frame-rate, precision, and VRAM fields;
- explicit documentation that map tiles are presentation-only, V2X is
  simulated, and the IR-style stream is not thermal data.

Verification:

- backend: 65 tests passed;
- frontend: 33 tests passed;
- TypeScript and Vite production build passed;
- the CPU IR smoke check produced a `48x64x3` `uint8` frame after syncing the
  declared OpenCV dependency;
- local `/api/health`, `/api/v2x/state`, and WebSocket telemetry responded;
- browser verification showed a connected supervisor, three selectable trucks,
  eight loaded satellite tiles, zero broken tiles, and no console warnings or
  errors after repairing an invalid minimap DOM property;
- Docker Compose configuration validation passed.

Docker Desktop was not running, so the merged containers were not rebuilt in
this verification. The online tile modes depend on external providers. No DSRC
or C-V2X radio is connected. The IR worker was not checked against the live Pi
feed or CUDA in this integration pass. None of these display features replaces
the ToF safety path.
