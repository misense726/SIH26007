# MI Sense — PROJECT_CONTEXT.md

## Project Identity

**Project:** MI Sense

**Target:** Smart India Hackathon 2026 — Problem Statement 26007  
**Domain:** Safe and efficient operation of mine vehicles in fog and low-visibility conditions in open-cast iron ore mines.

MI Sense is not primarily a fog detector. Its core is:

**Digital Twin + Synthetic Driver Awareness + Confidence-Aware Sensor Fusion**

The objective is to build a trusted digital representation of the haul road, continuously place the vehicle inside that representation, merge live spatial observations with the stored road model, and present a synthetic safe-driving view when the physical environment cannot be seen clearly.

---

# 1. Frozen Production Architecture

This production direction is canonical unless the project owner explicitly changes it.

## 1.1 LiDAR — Primary Geometric Sensor

LiDAR is the primary high-resolution spatial sensing and mapping layer.

Responsibilities:
- dense point-cloud acquisition;
- haul-road and berm geometry;
- terrain and obstacle reconstruction;
- reference Digital Twin creation;
- live geometric perception;
- map-change detection.

LiDAR is primary because of its geometric resolution, but it is not assumed to be perfectly reliable in dense fog.

## 1.2 mmWave Radar — Robust Redundant Sensing

Production dumpers use mmWave radar around the vehicle as required, especially front, front-side, side and rear-side coverage.

Responsibilities:
- independent obstacle and vehicle detection;
- range;
- relative velocity;
- blind-side awareness;
- collision-avoidance redundancy;
- stronger contribution when optical sensing confidence degrades.

Radar is not a replacement for LiDAR geometry.

## 1.3 RGB Camera — Visibility and Semantic Layer

Camera is secondary, not the primary navigation sensor.

Responsibilities:
- fog/visibility estimation;
- normal-condition semantic detection;
- vehicle/person/barrier recognition;
- visual driver feed;
- visual evidence for the supervisor;
- optical-confidence estimation.

## 1.4 Production Localization

Use:
- RTK-GNSS / DGPS;
- industrial INS / IMU;
- HEMM odometry / CAN;
- map matching.

Canonical production pose:
- x;
- y;
- z;
- heading;
- speed;
- localization confidence.

## 1.5 Production Fusion

Use confidence-aware fusion.

`OperationalWorld = ReferenceTwin + VehiclePose + LivePerception`

Do not simply average sensors. Unknown or degraded information must never be displayed as definitely safe.

---

# 2. Frozen V1 Proof-of-Concept

The current V1 is deliberately low-cost and exists to prove the complete software concept in a short development period.

The V1 must prove:

`range sensing -> spatial reconstruction -> Digital Twin -> live vehicle state -> driver awareness -> emergency response`

It is not intended to reproduce production-grade LiDAR, radar or positioning.

---

# 3. Frozen V1 Hardware

## 3.1 ToF Perception — 5 Sensors Total

### Scanning ToFs

1. **Front scanning VL53L1X**
   - servo-mounted;
   - approximately -80° to +80°;
   - primary V1 spatial scanner.

2. **Rear scanning VL53L1X**
   - servo-mounted;
   - approximately -80° to +80° relative to the rear;
   - provides rear spatial awareness.

### Fixed ToFs

3. **Front fixed VL53L0X V2**
4. **Left-side VL53L0X V2**
5. **Right-side VL53L0X V2**

Responsibilities:
- near-field proximity;
- side clearance;
- forward obstacle confirmation;
- continuous gap awareness;
- independent confirmation of nearby geometry.

These fixed ToFs are not radar substitutes.

The FRONT XIAO ESP32-C6 reads the front scanner and fixed-front ToF. The MIDDLE
ESP32-C3 Super Mini reads the fixed left and right ToFs. The normal ESP32 MAIN,
mounted at the back, reads the rear scanner locally. Every controller uses one
local I2C bus and gives each ToF a dedicated XSHUT GPIO. Firmware releases and
addresses local ToFs one at a time, verifies each runtime address, and repeats
the controller-local sequence after recovery. The V1 uses no I2C multiplexer.
The VL53LDK remains unused.

## 3.2 Motion and Environment

- MPU6050 IMU;
- BMP280 pressure/temperature sensor.

Hall odometry remains a future option. The code retains support for two
Hall-effect wheel sensors and wheel magnets, but the current physical profile
does not fit or read them.

BMP280 is used only for:
- pressure;
- temperature;
- approximate relative-altitude indication.

It must not be presented as precision positioning.

Use:

`relative_altitude = measured_altitude - startup_baseline`

Display it as approximate/relative.

## 3.3 Camera

Use Raspberry Pi Zero + normal RGB camera.

Responsibilities:
- primary driver video feed;
- visibility estimation;
- fog/smoke severity estimate;
- optional image dehazing/enhancement;
- future semantic detection.

The enhanced image is a driver-assistance layer, not safety truth.

Emergency-stop logic must never depend only on an ML-dehazed image.

## 3.4 V1 Positioning

Use:
- overhead camera;
- ArUco marker mounted on the RC vehicle.

This provides test-area x/y/heading.

ArUco is test infrastructure only.

Production equivalent:
- RTK-GNSS / DGPS;
- industrial INS;
- HEMM odometry;
- map matching.

## 3.5 Compute and Control

- FRONT XIAO ESP32-C6 for the front scanner, fixed-front ToF, and front servo;
- MIDDLE ESP32-C3 Super Mini for the fixed left and right ToFs;
- normal ESP32 MAIN at the back for the rear scanner and servo, wired UART
  aggregation, MPU6050, BMP280, and laptop USB telemetry. Hall inputs and relay
  control remain compiled but disabled for future use;
- Raspberry Pi Zero for camera streaming;
- GPU-capable laptop for mapping, Digital Twin, visualization, image enhancement and fusion;
- RC car as dumper-scale prototype.

## 3.6 Emergency Stop Simulation

The current physical profile does not connect a relay or motor-cut output. The
firmware and backend retain the output abstraction for a later hardware build.

Call it:

**Automatic Emergency Stop Simulation**

Do not claim mechanical braking if the implementation only removes motor power.

The current build still computes deterministic proximity warnings. A later
relay-enabled profile may use range and speed logic to request motor cut, never
camera ML alone.

---

# 4. V1-to-Production Mapping

| Production MI Sense | V1 |
|---|---|
| LiDAR | Front/rear servo-scanned VL53L1X |
| Local proximity sensing | Three fixed VL53L0X V2 sensors |
| Distributed mmWave radar | Future / simulated interface |
| RTK-GNSS | Overhead ArUco |
| Industrial INS | MPU6050 |
| HEMM wheel odometry/CAN | Reserved Hall-effect wheel sensor support |
| Altitude from GNSS/map | BMP280 relative altitude for demo |
| Vehicle RGB camera | Pi camera |
| Rugged edge computer | GPU laptop |
| 3D/elevation-aware mine twin | 2D/2.5D live spatial twin |

Never claim ToF is equivalent to industrial LiDAR.

Preferred wording:

> The V1 reproduces the angular ranging and spatial reconstruction principle using low-cost ToF sensors. Production MI Sense replaces this prototype layer with industrial LiDAR and distributed mmWave radar.

---

# 5. V1 Spatial Reconstruction

The V1 does not create a true dense 3D LiDAR point cloud.

It creates a **2D/2.5D surrounding occupancy representation**.

Each scanning measurement contains:
- servo angle θ;
- range r;
- timestamp.

Convert:

`x_local = r * sin(θ)`  
`y_local = r * cos(θ)`

Then transform:

`Sensor frame -> Vehicle frame -> World frame`

The renderer may vertically extrude detected boundaries/walls for a pseudo-3D or parking-assist style display.

Preferred terminology:
- 360° spatial awareness;
- 2.5D occupancy visualization;
- live surrounding reconstruction;
- proximity map.

Do not call it true 3D reconstruction.

---

# 6. Mapping Strategy

For initial reliability:

`Move -> Stop -> Scan -> Move -> Stop -> Scan`

Do not start with continuous-motion SLAM.

Workflow:
1. move RC vehicle a short distance;
2. stop;
3. front scanner sweeps;
4. rear scanner sweeps;
5. timestamp samples;
6. transform into world coordinates;
7. accumulate points;
8. repeat;
9. generate occupancy map;
10. save reference twin.

Continuous scanning and pose interpolation are later features.

---

# 7. Reference Twin vs Live Twin

## Reference Twin

Represents what should exist.

Contains:
- road polygon;
- centerline;
- berms/walls;
- intersections;
- hazard zones;
- route;
- static obstacles;
- map timestamp;
- map confidence.

## Live Twin

Represents current state.

Contains:
- vehicle pose;
- speed;
- trajectory;
- live ToF observations;
- proximity zones;
- unexpected obstacles;
- camera visibility score;
- relative altitude;
- sensor health;
- emergency-stop state;
- future radar objects.

`LiveTwin = ReferenceTwin + VehicleState + LiveObservations`

---

# 8. Driver Dashboard — Frozen Concept

The driver dashboard is the primary in-vehicle interface.

## Main Behavior

Keep the live Pi-camera feed visible.

Do not fully switch Camera -> ToF when visibility falls.

Use adaptive overlay.

### Good visibility
Show:
- live camera;
- minimal synthetic overlay;
- speed;
- safe state;
- compact proximity widget.

### Reduced visibility
Increase synthetic overlay intensity.

Show:
- green safe corridor;
- yellow caution;
- red obstacle;
- approximate obstacle distance;
- surrounding occupancy/wall reconstruction;
- warning state;
- visibility score.

## Top-Down 360° Awareness

Create a Tesla-style parking/proximity visualization.

Vehicle remains at the center.

Render:
- front scan;
- rear scan;
- left/right proximity;
- detected walls;
- nearby obstacles;
- danger bands.

This is ToF-derived spatial awareness, not a photorealistic 360° camera system.

## Camera Enhancement

Pipeline:

`Raw Camera -> Visibility Assessment -> Optional Dehazing/Enhancement -> Driver Overlay`

Allow RAW / ENHANCED comparison if useful.

Enhanced imagery must never override real range measurements.

---

# 9. Supervisor Dashboard — Frozen Concept

The supervisor dashboard is separate from the driver UI.

Main purpose:
- fleet overview;
- location;
- environmental status;
- vehicle state;
- safety alerts.

For each dumper show:
- dumper ID;
- x/y position;
- heading;
- speed;
- approximate relative altitude;
- temperature;
- pressure;
- visibility score;
- obstacle state;
- emergency-stop state;
- route;
- sensor health.

For V1:
- x/y/heading = ArUco;
- relative altitude = BMP280;
- temperature/pressure = BMP280.

For production:
- x/y/z = RTK-GNSS + INS + mine map.

The data model should support multiple dumpers even if V1 physically demonstrates only one.

For mode-specific presentation, follow **AGENTS.md → Simulation and live map
separation**. That section records the owner's map-only LIVE versus 3D SIMULATED
decision and distinguishes hardware MAIN from the Git `main` branch.

---

# 10. Safe Corridor

Compute:

`SafeCorridor = RoadArea - SafetyMargins - Hazards - LiveObstacles`

States:
- GREEN = verified usable;
- YELLOW = caution;
- RED = blocked/hazard;
- GREY = unknown/unverified.

A low-confidence corridor must not remain green.

---

# 11. Emergency Stop Logic

Do not use:

`ML sees object -> brake`

Use deterministic range + speed logic.

Inputs:
- nearest obstacle distance;
- vehicle speed;
- direction;
- sensor confidence.

Conceptually:

`critical_distance = reaction_distance + braking_margin + safety_margin`

When unsafe:
1. warn driver;
2. enter CRITICAL state;
3. if unsafe condition persists and threshold is crossed;
4. trigger relay/motor cut;
5. mark AUTOMATIC EMERGENCY STOP;
6. record the event.

---

# 12. Camera Visibility Logic

Start with explainable image metrics:
- contrast;
- edge density;
- brightness;
- entropy;
- haze proxy.

Output:
- visibility score 0..1;
- visibility state.

Suggested states:
- GOOD;
- MODERATE;
- LOW;
- VERY_LOW.

Later, an ML model may improve visibility estimation or dehazing.

Do not block the base system on ML.

---

# 13. ToF Timing

With multiple ToFs, do not blindly trigger all sensors simultaneously.

Use configurable staggered acquisition to reduce cross-interference.

Example acquisition sequence:
1. front scanner and front fixed, sequentially on the FRONT node;
2. left-side and right-side, sequentially on the MIDDLE node;
3. rear scanner, locally on MAIN.

The three controller-local schedules run independently. FRONT and MAIN use
configurable servo settle timing. FRONT and MIDDLE use optical guard timing
between local ToFs.

Timestamp every sample.

---

# 14. Canonical Software Interfaces

Required abstractions:

## RangeSensorProvider
- live ToF;
- simulated;
- replay;
- future LiDAR.

## AbsolutePositionProvider
- ArUco;
- simulated;
- future RTK-GNSS.

## OdometryProvider
- Hall;
- simulated;
- future HEMM CAN.

## CameraProvider
- Pi camera;
- replay;
- simulated.

## RadarProvider
- simulated;
- replay;
- future live radar.

## EnvironmentProvider
- BMP280;
- simulated/replay.

## EmergencyStopOutput
- simulated;
- relay/motor cut;
- future vehicle-control interface.

Changing sensors must not require rewriting:
- Digital Twin;
- world model;
- safe corridor;
- driver dashboard;
- supervisor dashboard.

---

# 15. V1 Success Criteria

V1 succeeds when it demonstrates:

1. real front/rear scanning ToF data;
2. real fixed-ToF proximity;
3. live spatial point map;
4. 2D/2.5D surrounding reconstruction;
5. ArUco vehicle localization;
6. IMU and ArUco vehicle motion, with Hall odometry reserved for later;
7. BMP280 relative altitude/pressure/temp;
8. supervisor dashboard;
9. driver camera feed;
10. camera visibility score;
11. adaptive spatial overlay;
12. safe corridor;
13. physical obstacle appearing in dashboard;
14. warning state;
15. emergency-stop state, with physical motor cut reserved for later;
16. operation in darkness;
17. optional mild smoke test;
18. record/replay;
19. future radar interface clearly labelled simulated/replay.

---

# 16. Truthful Claims

Allowed:
- V1 proves the architecture;
- V1 creates live low-cost spatial awareness;
- V1 creates a Digital Twin from range data;
- V1 maintains synthetic awareness when camera visibility degrades;
- V1 demonstrates emergency-stop logic;
- production architecture uses LiDAR primary + mmWave redundancy;
- production localization uses RTK-GNSS/INS/odometry.

Not allowed:
- V1 ToF is industrial LiDAR;
- V1 creates a true dense 3D LiDAR cloud;
- V1 proves full dense-fog operation;
- BMP280 precisely localizes altitude;
- dehazing restores true visual information;
- simulated radar is real;
- ArUco is production positioning;
- motor cut equals production hydraulic/service braking.

---

# 17. Frozen Project Rule

This file is the canonical MI Sense V1 architecture.

Do not change:
- sensor count/layout;
- dashboard roles;
- localization approach;
- emergency-stop philosophy;
- production mapping;

unless the project owner explicitly instructs a change.
