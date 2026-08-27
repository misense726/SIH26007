# Architecture

FogSen keeps one world state in the backend. Sensor providers normalize hardware, simulated, or replay data before it reaches the world model. API and WebSocket clients receive snapshots of that state. Neither dashboard owns a second map.

```text
providers -> normalized contracts -> canonical world model -> HTTP/WebSocket
                                                        -> driver dashboard
                                                        -> supervisor dashboard
```

## Wi-Fi camera path

The Raspberry Pi exposes one 1296×972 H.264 listener over Wi-Fi. The backend
keeps that single source drained, calculates explainable visibility metrics,
and fans out raw MJPEG to dashboard clients. A separate latest-frame worker runs
DehazeFormer-MCT on the laptop GPU; it never queues an old backlog and cannot
stall raw capture.

```text
Pi RGB camera -> Wi-Fi H.264 -> latest raw frame -> visibility metrics
                                      |          -> raw dashboard stream
                                      -> GPU dehazing -> enhanced dashboard stream
```

`CameraState.mode` is `LIVE` when the Pi feed is active even if the rest of the
Docker demo remains `SIMULATED`. The driver UI labels those sources separately.
If the camera or model becomes stale, the raw/enhanced availability flags clear
instead of reusing an old image.

The V1 internal frame uses metres. Vehicle positive X points right and positive Y points forward. The world frame is fixed local Cartesian. Heading increases clockwise from world positive Y.

## Simulation runtime

`FullSimulator` publishes the canonical `WorldState` at ten hertz. It drives the
five configured ToFs, route motion, Hall odometry, IMU, scheduled ArUco availability,
BMP280 environment values, camera visibility, occupancy, live-object detection,
safe corridor, and deterministic emergency-stop output through the same provider
contracts reserved for live and replay data.

NORMAL, FOG, OBSTACLE, and EMERGENCY are fixed scenario presets. The simulation
clock and sensor variation advance by telemetry tick, so identical controls produce
the same values. Every simulated source remains labelled `SIMULATED`.

## Live runtime

`FOGSEN_MODE=LIVE` selects `LiveSerialRuntime` instead of `FullSimulator`.
The runtime accepts MAIN TCP telemetry over Wi-Fi without blocking the API, translates the
five range readings and their individual ages into host timestamps, and replaces
the same canonical `WorldState` used by simulation. HTTP and WebSocket clients
therefore need no hardware-specific data path.

FRONT XIAO supplies the two front ranges. MIDDLE ESP32-C3 supplies the side
ranges. BACK/MAIN reads the rear scanner locally and merges all five readings
into the unchanged laptop contract.

Wi-Fi mode listens on TCP port `8765`. USB remains available for uploads and
diagnostics. Serial mode still requires `FOGSEN_SERIAL_PORT`. The runtime
reconnects after source or read failures. If the stream is absent or stale, it advances the world sequence with
five invalid ranges, offline or stale health, a grey corridor, and a warning.
It never freezes the last healthy snapshot. Simulation remains the default.

## Canonical map and pose

`WorldState` now owns the manually defined reference map, a multi-vehicle-ready pose list, sensor state, live objects, environment state, corridor state, emergency state, and spatial points. `maps/test_route.json` contains the road, centerline, two berms, route, hazard, speed zone, static obstacle, start, and destination.

The simulator samples the route polyline by travelled distance. It calculates heading clockwise from world positive Y and publishes the moving dumper inside the same state snapshot as the map.

## Safety boundary

Camera enhancement, BMP280, and simulated radar cannot trigger emergency stop by themselves. Raw and dehazed camera images are driver aids, not restored ground truth. The V1 simulation uses deterministic range, speed, freshness, and confidence checks. A triggered simulated motor cut stays latched until an explicit scenario change or reset. In `LIVE` mode, MAIN reports its cache-aware forward coverage and safety decision. The current hardware profile has no Hall speed input and no physical relay output, and reports both as disabled. The backend does not treat either one as live evidence. A later relay-enabled profile still requires bench verification.
