# MI Sense — AGENTS.md

All coding agents working on MI Sense must follow this file.

Read `PROJECT_CONTEXT.md` before making changes.

---

# 1. Core Goal

Build the complete working chain:

`ToF sensing -> spatial reconstruction -> Digital Twin -> localization -> live surroundings -> driver overlay -> supervisor view -> emergency response`

The dashboard alone is not the project.

The working sensing-to-twin pipeline is the project.

---

# 2. Build Base First

Do not implement everything at once.

Finish each milestone to a runnable state before beginning the next.

---

# 3. Milestones

## M0 — Repository Foundation

Create:
- backend;
- frontend;
- config;
- normalized models;
- WebSocket/API;
- simulator framework;
- test framework;
- docs.

Done when:
- backend runs;
- frontend runs;
- health/status works;
- frontend receives backend telemetry.

## M1 — Canonical World Model

Build one backend-owned world state.

Include:
- reference map;
- vehicle pose;
- live objects;
- sensor state;
- environment state;
- safe corridor;
- emergency state.

Do not maintain separate frontend-only maps.

## M2 — Base Digital Twin

Create a manually defined test route.

Include:
- road;
- boundaries/berms;
- centerline;
- hazard;
- start;
- destination.

Add a simulated dumper.

Done when:
- the dumper moves correctly in top-down coordinates.

## M3 — Driver Dashboard Base

Create:
- camera panel placeholder;
- 2.5D synthetic corridor;
- top-down proximity widget;
- speed;
- visibility;
- warning state.

Use the same world model as the supervisor view.

## M4 — Supervisor Dashboard Base

Create:
- fleet map;
- dumper card;
- x/y;
- heading;
- speed;
- relative altitude;
- pressure;
- temperature;
- visibility;
- obstacle state;
- emergency-stop state;
- sensor health.

Design the data model for multiple dumpers even if V1 uses one.

## M5 — Full Simulator

Simulate:
- 2 scanning ToFs;
- 3 fixed ToFs;
- Hall ticks;
- IMU;
- ArUco;
- BMP280;
- camera visibility;
- obstacles;
- emergency-stop conditions;
- future radar.

All simulator output must use the same data contracts as live hardware.

## M6 — Spatial Reconstruction

Implement:
- angle/range -> XY;
- sensor -> vehicle transforms;
- vehicle -> world transforms;
- front scanner;
- rear scanner;
- fixed proximity rays;
- accumulated spatial point map.

Start with stop-and-scan.

Do not implement continuous SLAM first.

## M7 — Occupancy / 2.5D Awareness

Create:
- occupancy representation;
- wall/boundary reconstruction;
- top-down 360° awareness;
- pseudo-3D extrusion for display.

Do not label it true 3D.

## M8 — Semantic Twin

Support:
- ROAD;
- CENTERLINE;
- BERM;
- HAZARD_ZONE;
- ROUTE;
- INTERSECTION;
- STATIC_OBSTACLE;
- SPEED_ZONE.

Manual/semi-manual editing is allowed.

Save/load the reference twin.

## M9 — Localization

Implement providers for:
- Hall odometry;
- MPU6050;
- ArUco absolute position.

Fuse into one normalized pose.

Expose confidence.

Do not let Digital Twin code depend directly on ArUco.

## M10 — Live Change Detection

Compare live ToF observations against the reference twin.

Generate:
- UNKNOWN_OBSTACLE;
- MAP_MISMATCH;
- proximity events.

Render changes in both dashboards.

## M11 — Safe Corridor

Compute:

`SafeCorridor = Road - SafetyMargin - Hazards - LiveObstacles`

States:
- GREEN;
- YELLOW;
- RED;
- GREY.

## M12 — Camera Visibility

Integrate simulated/replay visibility first.

Metrics:
- contrast;
- edge density;
- brightness;
- entropy/haze proxy.

Output:
- visibility_score;
- visibility_state.

## M13 — Camera Enhancement

Add optional dehazing/enhancement.

Rules:
- driver assistance only;
- preserve RAW feed;
- never use enhancement as sole braking truth;
- clearly separate raw and enhanced processing.

## M14 — Emergency Stop Logic

Implement deterministic logic from:
- obstacle distance;
- speed;
- direction;
- confidence.

Stages:
- SAFE;
- WARNING;
- CRITICAL;
- EMERGENCY_STOP.

Emergency-stop output must be hardware-abstracted.

## M15 — Record / Replay

Record:
- pose;
- ranges;
- visibility;
- BMP280;
- live objects;
- corridor;
- warnings;
- emergency stop.

Modes:
- LIVE;
- SIMULATED;
- REPLAY.

Always label them.

## M16 — ESP32 Hardware Integration

Use USB serial first.

The FRONT XIAO ESP32-C6 handles the front scanner, fixed-front ToF, and front
servo. The MIDDLE ESP32-C3 Super Mini handles the fixed left and right ToFs.

The normal ESP32 MAIN is mounted at the back and handles:
- the local rear scanner and rear servo;
- wired UART links from FRONT and MIDDLE;
- MPU6050;
- BMP280;
- reserved Hall inputs and relay output code, disabled in the current hardware
  profile;
- USB telemetry to the laptop.

Leave GPIO32, GPIO33, and GPIO25 unconnected in the current build. Preserve the
Hall odometry and motor-cut implementations for a later profile.

Use staggered ToF reads.

Each controller keeps its local ToFs on one I2C bus. Give every ToF a dedicated
XSHUT GPIO and assign runtime addresses one sensor at a time. Re-run the complete
controller-local address sequence after sensor or bus recovery. Use no I2C
multiplexer.

Timestamp everything.

## M17 — Real Scanning ToFs

Integrate:
- front VL53L1X + servo;
- rear VL53L1X + servo.

First goal:
- correct real points.

Do not chase perfect mapping immediately.

## M18 — Fixed ToFs

Integrate:
- front;
- left;
- right.

Show range rays and danger zones.

## M19 — Real Localization

Integrate:
- Hall;
- MPU6050;
- ArUco.

Done when:
- moving the RC car moves the digital dumper convincingly in the twin.

## M20 — BMP280

Integrate:
- pressure;
- temperature;
- relative altitude.

Set startup altitude baseline.

Label altitude as approximate/relative.

## M21 — Pi Camera

Integrate real camera.

Done when:
- live camera works;
- visibility metric works;
- darkness causes visibility score to fall;
- synthetic awareness continues.

## M22 — Physical Emergency Stop

Connect relay/motor cut.

Done when:
- unsafe range/speed condition triggers automatic motor cutoff;
- event appears in both dashboards.

Call it:
**Automatic Emergency Stop Simulation**

## M23 — Radar Abstraction

Create:
- simulated radar;
- replay radar;
- live radar placeholder.

Do not fake real radar.

## M24 — SIH Demo Mode

Create one demo workflow:

1. system health;
2. survey/map;
3. save twin;
4. navigation mode;
5. supervisor fleet view;
6. driver camera;
7. visibility reduction;
8. stronger synthetic overlay;
9. obstacle;
10. safe-corridor change;
11. driver warning;
12. emergency stop if driver does not slow;
13. BMP280/environment telemetry;
14. optional simulated radar;
15. record/replay.

---

# 4. Required Provider Interfaces

## RangeSensorProvider
Implementations:
- live ToF;
- simulated;
- replay;
- future LiDAR.

## AbsolutePositionProvider
Implementations:
- ArUco;
- simulated;
- future RTK-GNSS.

## OdometryProvider
Implementations:
- Hall;
- simulated;
- future HEMM CAN.

## CameraProvider
Implementations:
- Pi camera;
- replay;
- simulated.

## EnvironmentProvider
Implementations:
- BMP280;
- simulated;
- replay.

## RadarProvider
Implementations:
- simulated;
- replay;
- future live radar.

## EmergencyStopOutput
Implementations:
- simulated;
- relay/motor cut;
- future vehicle-control interface.

---

# 5. Source of Truth

Backend world model owns:
- map;
- vehicle state;
- live obstacles;
- proximity;
- safe corridor;
- environment;
- sensor state;
- emergency state.

Driver and supervisor dashboards render this same state.

---

# 6. Coordinate Rules

Internal units:
- metres;
- seconds;
- consistent angle convention.

Vehicle frame:
- +X right;
- +Y forward.

World frame:
- fixed local Cartesian.

Document every transform.

---

# 7. Calibration

Put calibration in configuration:
- sensor positions;
- sensor orientations;
- servo limits;
- servo centers;
- ToF offsets;
- wheel circumference;
- magnets per wheel;
- wheel spacing;
- ArUco transform;
- BMP280 baseline;
- safety distances;
- occupancy-grid resolution.

No scattered hard-coded calibration.

---

# 8. ToF Timing

Five ToFs may interfere optically.

Read each controller's ToFs sequentially with configurable timing. The FRONT
and rear scans remain independent. MAIN owns the rear scan locally, while the
MIDDLE C3 reads the two side ToFs sequentially.

At node boot and recovery, hold every local XSHUT low, then enable, initialize,
address, and verify each sensor before enabling the next one.

Timestamp every range reading.

---

# 9. Safety Rules

Unknown is not safe.

Stale sensors must degrade confidence.

Emergency stop must not be triggered solely by:
- dehazed image;
- object-detection ML;
- BMP280;
- simulated radar.

Use deterministic live range/speed logic for V1.

---

# 10. UI Rules

Driver UI:
- camera-first;
- adaptive spatial overlay;
- minimal clutter;
- safe path;
- obstacles;
- speed;
- warning;
- 360° awareness.

Supervisor UI:
- fleet map;
- vehicle states;
- environment;
- altitude;
- sensor health;
- alerts.

Do not copy supervisor telemetry clutter into the driver view.

## Simulation and live map separation

The owner confirmed this distinction on 2026-09-06:

- **SIMULATED:** the haul scenario uses the illustrative 3D mine, moving dumpers,
  crusher, rock encounter and passing traffic. Emphasize the mine, vehicles and
  crusher; vegetation is background context.
- **LIVE:** the supervisor gets the reference map and actual backend telemetry.
  It does not use the simulated 3D mine, procedural terrain or scripted encounters.
  Existing sensor-derived driver awareness remains separate from that mine scene.
- **REPLAY:** render recorded state on the standard map; do not start a haul cycle.

Here, "main data" means LIVE hardware data, not the Git `main` branch. Both modes
may ship on that branch. MAIN is the ESP32 telemetry aggregator, not a simulation
mode. Backend `WorldState` owns poses and observations in every mode; the browser
only renders them. Missing live localization stays unknown, not simulated motion.

When changing maps, mode selection or haul behavior, read `docs/haul-simulation.md`.
Verify that only SIMULATED snapshots with a haul route mount the 3D mine, that LIVE
and REPLAY stay on the standard map even with residual haul metadata, and that
leaving the scene releases its graphics resources. Keep the mode label visible.

---

# 11. Truthfulness

Always label:
- LIVE;
- SIMULATED;
- REPLAY.

Never label:
- 2.5D ToF map as true 3D LiDAR;
- relative BMP altitude as precise altitude;
- motor cut as production braking;
- ArUco as field localization;
- dehazed image as ground truth.

---

# 12. Agent Working Style

Do not ask the user for minor engineering defaults.

Choose reasonable defaults and document them.

If hardware is unavailable:
1. create interface;
2. simulate/replay it;
3. continue downstream development.

After every milestone:
1. run tests;
2. launch system;
3. verify visible behavior;
4. update docs;
5. report limitations;
6. only then continue.
