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

Status: compiled and uploaded on 2026-08-28; live bench verification is partial.

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
- validated VL53L1X short-mode timing at 20 ms, 5-degree scan steps, and 30 ms
  default servo settling;
- bounded FRONT I2C bus clearing, 100 kHz recovery, address-stage diagnostics,
  and longer XSHUT reset timing;
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

- MAIN: 966,007 bytes flash and 60,004 bytes globals;
- FRONT: 311,620 bytes flash and 15,892 bytes globals;
- MIDDLE: 317,042 bytes flash and 14,232 bytes globals;
- 37 firmware and wired protocol contract tests passed;
- all three targets compiled with warnings enabled through
  `scripts/verify-firmware.ps1`;
- Arduino CLI identified and uploaded MAIN ESP32-D0WD-V3 on COM11, FRONT
  ESP32-C6FH4 on COM5, and MIDDLE ESP32-C3 on COM3;
- an isolated rear-sensor probe returned 40 of 40 valid readings in short mode
  at both 20 and 33 ms, with no timeouts. Medium and long modes returned no
  valid readings in the same fixed setup, so the temporary probe was removed
  and short 20 ms was retained in production firmware;
- the optimized rear scan measured about 17.5 samples per second with 99.3%
  valid returns. MIDDLE measured about 13 to 14 range pairs per second with
  both side ranges valid.

The FRONT pair initially passed the full five-ToF harness after the correct C6
image was uploaded. Later, both front sensors disappeared together from their
shared bus. Direct COM5 diagnostics show both XSHUT pins high and SDA/SCL high,
but no response at default or runtime addresses. Firmware correctly publishes
both ranges as unknown. Reseat or power-cycle the FRONT VCC, ground, SDA, and
SCL path before closing the physical bench check. Servo motion, optical
interference, supply endurance, Hall inputs, and relay polarity still require
separate physical checks.

## Five-sensor sensing-to-dashboard chain

Status: software-verified and Wi-Fi transport bench-verified on 2026-08-28;
FRONT shared-bus repair remains open.

Implemented:

- explicit `FOGSEN_MODE=LIVE` runtime with Wi-Fi TCP telemetry and USB serial fallback;
- LAN-aware live launcher that resolves the Pi hostname, binds MAIN's TCP
  listener on all interfaces, and keeps raw camera ingest independent from the
  telemetry source;
- sensor-only live launcher mode for runs where the Pi camera is intentionally
  offline;
- repeatable live-network check for fresh MAIN packets and five range records,
  with an optional Pi camera requirement;
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

- backend: 66 tests passed, including fake-serial packet to API and WebSocket,
  host stale timeout, serial-open failure, duplicate rejection, and controller
  restart;
- frontend: 37 tests passed and the TypeScript/Vite production build passed;
- all three Arduino targets compiled with warnings enabled and the wired
  protocol checks passed;
- on the connected bench, the 115200-baud COM11 fallback sustained about 9.7
  full packets per second, both UART links stayed fresh, and MIDDLE left/right
  ranges stayed valid;
- the live backend received MAIN Wi-Fi at about 19 updates per second against
  the 20 Hz target and exposed all five range records through HTTP/WebSocket;
- the sensor-only network check passed with real rear, left, and right values,
  both unavailable front readings preserved as unknown, and the camera check
  explicitly skipped.

The Pi camera was intentionally disabled for this run. Camera, ArUco absolute
localization, and radar were not part of the sensor bench test. Without an
absolute pose source, `LIVE` position confidence stays zero and the live
corridor remains grey.

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

## Chennai road navigation, V2X, and main ToF display

Status: locally integrated and software-verified on 2026-08-28. Radio, thermal
camera, live Pi IR, Docker rebuild, and physical vehicle checks remain pending.

Implemented:

- a compact rectangular road map in the driver camera view with stable primary
  and peer vehicle arrows;
- an expanded OpenStreetMap road view capped at zoom 18, with a transparent tile
  fallback instead of provider error artwork;
- a supervisor map with backend schematic and road modes, multi-truck selection,
  speed labels, and matching fleet cards;
- no radar sweep, pulsing marker, blinking marker, animated route, or terrain
  layer;
- a Chennai display anchor for `V699+X9`, with the canonical demo route aligned
  to mapped campus roads;
- `DUMPER_02` placed on the west campus road about 61 metres from the primary
  route start;
- a five-channel ToF list in the main `360° proximity` card, showing each
  sensor's distance, health, and scanner angle or quality;
- the physical five-sensor display layout: level front and rear servo heads,
  plus fixed front, left, and right heads pitched about 50 degrees down;
- stale, offline, invalid, or disconnected range channels display `Unknown`
  instead of a maximum-distance value;
- `V2XState` in the shared world snapshot plus peer, roadside-unit, advisory,
  packet-log, and link-estimate models;
- V2X state, incoming BSM, and advisory broadcast API endpoints;
- a CPU or CUDA false-colour IR worker derived from RGB luminance, with status,
  frame, stream, latency, frame-rate, precision, and VRAM fields;
- explicit documentation that road tiles are presentation-only, V2X is
  simulated, and the IR-style stream is not thermal data.

Verification:

- backend: 66 tests passed;
- frontend: 37 tests passed;
- TypeScript and Vite production build passed;
- local `/api/health`, `/api/v2x/state`, and WebSocket telemetry responded;
- browser verification showed all five named ToFs with numeric values, healthy
  status, and independently changing scanner angles;
- the expanded map showed Chennai road tiles, the separate `DUMPER_02` marker,
  the configured zoom cap, and no marker animations;
- a clean browser reload added no console warnings or errors.

The dashboard proves that normalized backend readings reach the five visible
sensor rows. Simulated values do not prove physical ToF accuracy, UART delivery,
or Wi-Fi delivery from MAIN. No DSRC or C-V2X radio is connected. None of the map,
V2X, camera, or IR display features replaces the ToF safety path.

## Operator dashboard and firmware hardening

Status: locally integrated, Docker-verified, and host-telemetry-verified on
2026-08-31. Hardware upload and fault-injection recovery tests remain pending.

Implemented:

- URL-backed Driver, Spatial, Fleet, and Calibration navigation with a compact
  mobile navigation bar, keyboard support, accessible status labels, and a
  compact operator header;
- concise operator copy with setup and implementation narration removed from
  normal views;
- fail-closed corridor, proximity, fleet, and settings displays so incomplete,
  stale, unhealthy, or disconnected data cannot appear clear or current;
- primary-vehicle selection by `primary_vehicle_id`, empty-fleet handling,
  canonical alert counting, and explicit `SIMULATED` labels for V2X peers and
  advisory controls;
- bounded settings validation, malformed WebSocket snapshot rejection, and a
  view-level render fallback;
- camera stream error and retry handling, with the RGB-derived view labelled
  false colour instead of infrared;
- Wi-Fi telemetry session generations so a queued frame from an old TCP session
  cannot be sent after reconnect;
- IMU and BMP280 cache invalidation after repeated read failure;
- a 256-byte FRONT UART transmit buffer plus compile-time pin, address, scan,
  servo, timing, and packet-capacity checks;
- bounded MIDDLE I2C bus clearing before Wire restarts.

Verification:

- backend: 66 tests passed;
- frontend: 70 tests passed across 16 files;
- TypeScript and Vite production build passed;
- all 40 firmware contract checks passed;
- MAIN, FRONT, and MIDDLE compiled for their pinned FQBNs with warnings enabled;
- Docker Compose rebuilt the committed images; backend and frontend were healthy
  with zero restarts, and `/healthz` plus the dashboard returned HTTP 200;
- the host-side MAIN check on the identified CP210x USB-UART port passed all 12
  live five-ToF checks across 74 packets; it discarded 9 non-telemetry lines and
  no oversized lines;
- the simulated dashboard remained connected through WebSocket telemetry;
- all four views rendered at desktop and 390×844 mobile sizes without horizontal
  overflow or browser console warnings or errors; theme switching passed in
  both layouts;
- Normal, Fog, Obstacle, and Emergency scenarios, pause, resume, reset, camera
  awareness modes, map expansion, sensor detail, and settings validation were
  exercised in the browser.

The Docker stack is serving the dashboard on port 8080 and the backend on ports
8000 and 8765. COM3 and COM5 identify as Espressif USB-JTAG/serial devices;
COM11 identifies as the CP210x USB-UART used by MAIN. No firmware was uploaded,
so the live packet check confirms the connected chain but not that the newly
compiled images are running. Compilation and telemetry do not prove reconnect
freshness under fault, stuck-bus recovery, sensor wiring, servo motion, or
long-run vehicle stability.
