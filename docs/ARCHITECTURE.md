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
                                      -> RGB false-color -> IR-style dashboard stream
```

`CameraState.mode` is `LIVE` when the Pi feed is active even if the rest of the
Docker demo remains `SIMULATED`. The driver UI labels those sources separately.
If the camera or a processing worker becomes stale, its raw, enhanced, or IR
availability flag clears instead of reusing an old image.

The IR-style branch is a presentation transform of the RGB frame. Its CPU path
uses OpenCV CLAHE and a color map. Its CUDA path uses PyTorch luminance and a
GPU color lookup table. It does not read temperature or produce thermal-camera
data. The raw, dehazed, and IR-style images remain outside the deterministic
motor-cut decision.

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
The runtime accepts MAIN telemetry over USB serial, Wi-Fi TCP, or both without
blocking the API. It translates the
five range readings and their individual ages into host timestamps, and replaces
the same canonical `WorldState` used by simulation. HTTP and WebSocket clients
therefore need no hardware-specific data path.

FRONT XIAO supplies the two front ranges. MIDDLE ESP32-C3 supplies the side
ranges. BACK/MAIN reads the rear scanner locally and merges all five readings
into the unchanged laptop contract.

Wi-Fi mode listens on TCP port `8765` on all interfaces so MAIN can reach the
laptop over the same LAN. Serial mode requires `FOGSEN_SERIAL_PORT`. `BOTH`
wraps both readers behind one provider, reconnects them independently, and
uses MAIN's sequence and controller clock to reject duplicate or old frames.
A failure on one input does not close the other. If every stream is absent or
stale, the runtime advances the world sequence with
five invalid ranges, offline or stale health, a grey corridor, and a warning.
It never freezes the last healthy snapshot. Simulation remains the default.

The React frontend keeps application chrome in `frontend/src/layout/AppShell.tsx`
and view selection in `frontend/src/layout/DashboardViewRouter.tsx`. Driver,
spatial, supervisor, settings, state, and map modules remain separate so a
layout change does not need to touch telemetry normalization or safety logic.

## Map presentation boundary

The backend `ReferenceMap` is the only operational map used by the simulator,
spatial reconstruction, corridor logic, and safety state. The supervisor's
schematic view renders that model directly.

Leaflet provides optional geographic presentation views. The configured site
is `V699+X9, Chennai, Tamil Nadu`. The frontend converts the backend's local
Cartesian vehicle coordinates around that anchor, then draws the primary
vehicle, the canonical road-aligned route, and simulated peers over
OpenStreetMap road tiles. The driver has compact and expanded maps. The
supervisor can switch between the schematic and road-map views.

The site anchor and external tiles are not a second operational twin. They do
not update `ReferenceMap`, localize the vehicle, change the safe corridor, or
trigger emergency logic. Failed tiles become transparent instead of covering
the route. The backend schematic and all safety functions continue to work.

## Simulated V2X boundary

`V2XManager` consumes the current vehicle pose, safe corridor, emergency state,
and nearest obstacle. It emits `V2XState` into the same `WorldState` snapshot
used by both dashboards. The state includes simulated peer vehicles, roadside
units, basic safety messages, advisories, link estimates, counters, and a
bounded message log.

```text
vehicle pose + corridor + emergency -> V2XManager -> WorldState.v2x
                                                   -> V2X API
                                                   -> supervisor and map views
```

The current protocol version is `1.0-DSRC-SIM`. The 5.89 GHz value is simulated
metadata. No DSRC or C-V2X radio is connected, and API advisory broadcasts only
change in-memory state. V2X currently observes safety state but does not replace
ToF evidence or command the emergency output.

## Canonical map and pose

`WorldState` now owns the manually defined reference map, a multi-vehicle-ready pose list, sensor state, live objects, environment state, corridor state, emergency state, and spatial points. `maps/test_route.json` contains the road, centerline, two berms, route, hazard, speed zone, static obstacle, start, and destination.

The simulator samples the route polyline by travelled distance. It calculates heading clockwise from world positive Y and publishes the moving dumper inside the same state snapshot as the map.

## Safety boundary

Camera enhancement, BMP280, and simulated radar cannot trigger emergency stop by themselves. Raw and dehazed camera images are driver aids, not restored ground truth. The V1 simulation uses deterministic range, speed, freshness, and confidence checks. A triggered simulated motor cut stays latched until an explicit scenario change or reset. In `LIVE` mode, MAIN reports its cache-aware forward coverage and safety decision. The current hardware profile has no Hall speed input and no physical relay output, and reports both as disabled. The backend does not treat either one as live evidence. A later relay-enabled profile still requires bench verification.
