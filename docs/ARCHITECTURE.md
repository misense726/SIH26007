# Architecture

FogSen keeps one world state in the backend. Sensor providers normalize hardware, simulated, or replay data before it reaches the world model. API and WebSocket clients receive snapshots of that state. Neither dashboard owns a second map.

```text
providers -> normalized contracts -> canonical world model -> HTTP/WebSocket
                                                        -> driver dashboard
                                                        -> supervisor dashboard
```

The V1 internal frame uses metres. Vehicle positive X points right and positive Y points forward. The world frame is fixed local Cartesian. Heading increases clockwise from world positive Y.

## Simulation runtime

`FullSimulator` publishes the canonical `WorldState` at ten hertz. It drives the
six configured ToFs, route motion, Hall odometry, IMU, scheduled ArUco availability,
BMP280 environment values, camera visibility, occupancy, live-object detection,
safe corridor, and deterministic emergency-stop output through the same provider
contracts reserved for live and replay data.

NORMAL, FOG, OBSTACLE, and EMERGENCY are fixed scenario presets. The simulation
clock and sensor variation advance by telemetry tick, so identical controls produce
the same values. Every simulated source remains labelled `SIMULATED`.

## Canonical map and pose

`WorldState` now owns the manually defined reference map, a multi-vehicle-ready pose list, sensor state, live objects, environment state, corridor state, emergency state, and spatial points. `maps/test_route.json` contains the road, centerline, two berms, route, hazard, speed zone, static obstacle, start, and destination.

The simulator samples the route polyline by travelled distance. It calculates heading clockwise from world positive Y and publishes the moving dumper inside the same state snapshot as the map.

## Safety boundary

Camera enhancement, BMP280, and simulated radar cannot trigger emergency stop by themselves. The V1 simulation uses deterministic range, speed, freshness, and confidence checks. A triggered simulated motor cut stays latched until an explicit scenario change or reset. The physical relay remains a separate bench-verified output.
