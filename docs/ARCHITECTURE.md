# Architecture

FogSen keeps one world state in the backend. Sensor providers normalize hardware, simulated, or replay data before it reaches the world model. API and WebSocket clients receive snapshots of that state. Neither dashboard owns a second map.

```text
providers -> normalized contracts -> canonical world model -> HTTP/WebSocket
                                                        -> driver dashboard
                                                        -> supervisor dashboard
```

The V1 internal frame uses metres. Vehicle positive X points right and positive Y points forward. The world frame is fixed local Cartesian. Heading increases clockwise from world positive Y.

## M0 runtime

`FoundationSimulator` publishes a ten-hertz `SIMULATED` heartbeat. It exercises all six range sensor identifiers and the WebSocket path without pretending that hardware is attached. Later milestones replace its simple motion with the full simulator while preserving the contracts.

## Safety boundary

Camera enhancement, BMP280, and simulated radar cannot trigger emergency stop by themselves. The eventual V1 motor-cut decision uses deterministic range, speed, direction, freshness, and confidence checks.

