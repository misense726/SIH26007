# FogSen — MASTER_AGENT_PROMPT.md

You are the main engineering agent for **FogSen**.

Before writing code:

1. Read `PROJECT_CONTEXT.md` completely.
2. Read `AGENTS.md` completely.
3. Read `README.md` and relevant `docs/` files if present.
4. Treat `PROJECT_CONTEXT.md` as the frozen architecture.
5. Treat `AGENTS.md` as mandatory development policy.

Do not redesign the project unless explicitly instructed by the project owner.

---

# Mission

Build the complete **FogSen V1 proof-of-concept** in phases.

FogSen should demonstrate:

**low-cost spatial reconstruction + Digital Twin + driver synthetic awareness + supervisor fleet awareness + emergency-stop simulation**

The V1 hardware is:
- 2 × servo-scanned VL53L1X;
- 3 × fixed VL53L0X V2;
- 2 × SG90 servos;
- 1 × XIAO ESP32-C6 FRONT node;
- 1 × ESP32-C3 Super Mini MIDDLE node;
- 1 × normal ESP32 BACK/MAIN controller;
- MPU6050;
- BMP280;
- Raspberry Pi Zero;
- RGB Pi camera;
- overhead camera + ArUco;
- reserved Hall wheel sensor and relay/motor-cut support, disabled in the
  current physical profile;
- RC car;
- GPU-capable laptop.

The VL53LDK remains unused.

Production architecture is:

**LiDAR primary + distributed mmWave radar redundancy + RGB camera + RTK-GNSS/INS/HEMM odometry**

Do not require production hardware for V1.

---

# Critical Rule

## BUILD THE BASE FIRST.

Do not start multiple advanced features simultaneously.

Follow the milestone order in `AGENTS.md`.

A milestone is complete only when:
- it runs;
- tests pass;
- the result is demonstrable;
- docs are updated.

Then move on.

---

# Recommended Stack

## Backend
Python 3.11+

Prefer:
- FastAPI;
- Pydantic;
- NumPy;
- Shapely;
- OpenCV;
- SciPy only where useful;
- pyserial;
- SQLite;
- JSONL or Parquet for recordings.

## Frontend
- React;
- TypeScript;
- Vite;
- Three.js / React Three Fiber where useful.

Do not add ROS 2 unless explicitly requested.

No cloud dependency.

---

# Initial Repository

Create approximately:

```text
fogsen/
├── README.md
├── PROJECT_CONTEXT.md
├── AGENTS.md
├── config/
│   ├── vehicle.yaml
│   ├── sensors.yaml
│   ├── safety.yaml
│   └── demo.yaml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATA_CONTRACTS.md
│   ├── HARDWARE.md
│   ├── CALIBRATION.md
│   └── DEMO.md
├── firmware/
│   └── esp32/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── providers/
│   │   ├── localization/
│   │   ├── mapping/
│   │   ├── twin/
│   │   ├── perception/
│   │   ├── safety/
│   │   ├── visibility/
│   │   ├── simulation/
│   │   ├── replay/
│   │   └── logging/
│   └── tests/
├── frontend/
│   └── src/
│       ├── driver/
│       ├── supervisor/
│       ├── twin/
│       ├── components/
│       └── state/
├── maps/
├── recordings/
└── scripts/
```

---

# M0 — Foundation

Create:
- health endpoint;
- system-status endpoint;
- WebSocket skeleton;
- frontend/backend connectivity;
- config loader;
- normalized data models;
- test harness;
- simulator interfaces.

Define at minimum:

## VehiclePose

```json
{
  "timestamp_ms": 0,
  "vehicle_id": "DUMPER_01",
  "x_m": 0.0,
  "y_m": 0.0,
  "heading_deg": 0.0,
  "speed_mps": 0.0,
  "position_confidence": 1.0,
  "mode": "SIMULATED"
}
```

## RangeReading

```json
{
  "timestamp_ms": 0,
  "sensor_id": "front_scanner",
  "angle_deg": 0.0,
  "range_m": 0.0,
  "quality": 1.0,
  "mode": "SIMULATED"
}
```

## EnvironmentState

```json
{
  "timestamp_ms": 0,
  "temperature_c": 0.0,
  "pressure_hpa": 0.0,
  "relative_altitude_m": 0.0,
  "visibility_score": 1.0,
  "visibility_state": "GOOD",
  "mode": "SIMULATED"
}
```

## LiveObject

```json
{
  "timestamp_ms": 0,
  "object_id": "obj-1",
  "x_m": 0.0,
  "y_m": 0.0,
  "object_type": "UNKNOWN",
  "confidence": 1.0,
  "source": "TOF",
  "mode": "SIMULATED"
}
```

## EmergencyState

```json
{
  "state": "SAFE",
  "reason": null,
  "nearest_obstacle_m": null,
  "motor_cut": false
}
```

Use enums where appropriate.

---

# Then Build One Feature at a Time

## Feature 1 — Canonical World Model

Backend owns:
- reference map;
- live vehicle states;
- environment;
- live objects;
- sensor health;
- safe corridor;
- emergency state.

No duplicated frontend state.

## Feature 2 — Base Digital Twin

Create a manually defined mine-style road.

Include:
- road;
- centerline;
- walls/berms;
- hazard area;
- start;
- destination.

Add simulated dumper.

Acceptance:
- dumper moves correctly in map coordinates.

## Feature 3 — Driver Dashboard

Build the driver dashboard before real sensors.

Main layout:
- large camera panel;
- 2.5D synthetic overlay;
- top-down 360° proximity widget;
- speed;
- visibility;
- warning;
- nearest obstacle;
- emergency-stop indicator.

Good visibility:
- light overlay.

Poor visibility:
- stronger synthetic overlay.

Do not switch the camera completely off unless the feed is unavailable.

## Feature 4 — Supervisor Dashboard

Create:
- fleet map;
- dumper location;
- speed;
- heading;
- relative altitude;
- pressure;
- temperature;
- visibility;
- sensor health;
- obstacle state;
- emergency state;
- alert log.

Architecture must support multiple dumpers.

## Feature 5 — Full Simulator

Simulate:
- two scanning ToFs;
- three fixed ToFs;
- Hall ticks;
- IMU;
- ArUco;
- BMP280;
- camera visibility;
- obstacles;
- emergency conditions;
- future radar.

All simulator data must use the same provider interfaces as live hardware.

## Feature 6 — Spatial Reconstruction

Implement scanner math:

`x_local = r * sin(theta)`  
`y_local = r * cos(theta)`

Then:

`Sensor -> Vehicle -> World`

Implement both front and rear scanners.

Render:
- points;
- rays;
- walls/boundaries;
- occupancy.

Start with stop-and-scan.

## Feature 7 — 2.5D / 360° Awareness

Build Tesla-style top-down proximity view.

Vehicle remains at center.

Render:
- front scan;
- rear scan;
- left/right proximity;
- nearby walls;
- obstacle zones.

Optional display extrusion can make walls appear 3D.

Do not label as true 3D.

## Feature 8 — Semantic Twin

Add:
- ROAD;
- CENTERLINE;
- BERM;
- ROUTE;
- HAZARD_ZONE;
- INTERSECTION;
- STATIC_OBSTACLE.

Support save/load.

## Feature 9 — Localization

Implement normalized providers for:
- Hall odometry;
- MPU6050;
- ArUco.

Fuse into `VehiclePose`.

Future RTK-GNSS must replace ArUco through the same interface.

## Feature 10 — Live Change Detection

Compare live ToF geometry with reference twin.

Generate:
- obstacle;
- map mismatch;
- proximity warning.

Update both dashboards.

## Feature 11 — Safe Corridor

Compute:

`SafeCorridor = Road - SafetyMargin - Hazards - LiveObstacles`

States:
- GREEN;
- YELLOW;
- RED;
- GREY.

## Feature 12 — Camera Visibility

Start with simple metrics:
- contrast;
- edge density;
- brightness;
- entropy/haze proxy.

Output:
- score 0..1;
- state GOOD/MODERATE/LOW/VERY_LOW.

Use visibility to change overlay intensity.

## Feature 13 — Camera Enhancement

Add optional dehazing/enhancement.

Rules:
- preserve raw camera;
- enhanced image is driver aid only;
- no braking solely from enhanced image;
- clearly distinguish processing stage.

## Feature 14 — Emergency Stop Logic

Use deterministic distance + speed logic.

Inputs:
- nearest valid obstacle;
- current speed;
- direction;
- sensor confidence.

States:
- SAFE;
- WARNING;
- CRITICAL;
- EMERGENCY_STOP.

When threshold is crossed:
- warn driver;
- if unsafe condition persists;
- trigger `EmergencyStopOutput`.

Do not use ML alone.

## Feature 15 — Record / Replay

Record:
- pose;
- all ToFs;
- environment;
- visibility;
- objects;
- corridor;
- alerts;
- emergency stop.

Modes:
- LIVE;
- SIMULATED;
- REPLAY.

---

# Only Then Integrate Hardware

## Feature 16 — ESP32 Serial

Use USB serial first.

Receive:
- front scanner angle/range;
- rear scanner angle/range;
- three fixed ranges;
- Hall counts;
- MPU6050;
- BMP280;
- relay state.

Timestamp all samples.

Use staggered ToF acquisition.

## Feature 17 — Real Scanners

Integrate both VL53L1X + servos.

First:
- show correct points.

Then:
- accumulate/map.

## Feature 18 — Fixed ToFs

Integrate three VL53L0X V2 sensors.

Show:
- front;
- left;
- right;
- danger zones.

## Feature 19 — Real Localization

Integrate:
- Hall;
- MPU6050;
- ArUco.

Acceptance:
- physical RC car movement is reflected convincingly in the twin.

## Feature 20 — BMP280

Integrate:
- pressure;
- temperature;
- startup-relative altitude.

Clearly label relative altitude as approximate.

## Feature 21 — Pi Camera

Integrate live video.

Acceptance:
- camera feed works;
- visibility score responds to darkness/obscuration;
- synthetic overlay remains available.

## Feature 22 — Relay Emergency Stop

Connect motor-cut relay.

Acceptance:
- obstacle + unsafe speed triggers motor cut;
- driver dashboard shows EMERGENCY STOP;
- supervisor dashboard receives alert;
- event is recorded.

Call this:
**Automatic Emergency Stop Simulation**

## Feature 23 — Radar Abstraction

Implement:
- `SimulatedRadarProvider`;
- `ReplayRadarProvider`;
- `LiveRadarProvider` placeholder.

Never fake radar hardware.

---

# Final SIH Demo

Create one deterministic demo:

1. launch system;
2. supervisor dashboard online;
3. driver dashboard online;
4. survey route;
5. show scan points;
6. generate/save twin;
7. navigation mode;
8. vehicle localization;
9. BMP280 telemetry;
10. normal camera visibility;
11. reduce visibility/darkness;
12. overlay becomes stronger;
13. show 360° awareness;
14. introduce obstacle;
15. obstacle appears;
16. safe corridor changes;
17. driver does not slow;
18. emergency motor cut triggers;
19. supervisor receives alert;
20. optional simulated radar;
21. record;
22. replay.

---

# Engineering Rules

- Do not force GPU use for simple ToF math.
- Do not overbuild 3D before the 2D/2.5D pipeline works.
- Do not block on unavailable hardware.
- Keep providers hardware-independent.
- Keep calibration in config.
- Keep sensor source/mode visible.
- Unknown is not safe.
- Enhanced camera imagery is not ground truth.
- BMP280 altitude is approximate.
- ToF reconstruction is not true LiDAR.

Proceed autonomously through milestones.

At the end of each milestone report:
- implemented;
- files changed;
- tests;
- launch command;
- visible result;
- limitations;
- next milestone.

Start with M0 and continue sequentially.
