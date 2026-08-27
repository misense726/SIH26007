# Data contracts

The backend models in `backend/app/models` are canonical. Unknown fields fail validation so sensor adapters cannot silently change the contract.

Every telemetry payload includes a source mode:

- `LIVE` means a connected hardware provider produced the data;
- `SIMULATED` means the deterministic demo produced it;
- `REPLAY` means a saved recording produced it.

## M0 world state

`WorldState` contains:

- a schema version, generation timestamp, and monotonic sequence;
- a primary vehicle identifier and a list of `VehiclePose` values;
- one `ReferenceMap` with typed semantic features;
- normalized `RangeReading` values;
- `EnvironmentState`;
- `LiveObject` values;
- `EmergencyState`;
- per-sensor `SensorHealth`;
- one `V2XState` containing the current simulated V2V/V2I state;
- the safe corridor and spatial point collections used by later milestones.

The HTTP endpoint `/api/world` and WebSocket endpoint `/ws/telemetry` serialize the same model.

## V1 range sensors

The canonical range sensor identifiers are:

- `front_scanner`;
- `front_fixed`;
- `rear_scanner`;
- `left_side`;
- `right_side`.

Live, simulated, and replay providers publish the same five identifiers. Each
range keeps its own timestamp, validity, quality, angle, and source mode. A
missing, rejected, timed-out, or out-of-range sample remains present as invalid
or unknown data. Providers never substitute the configured maximum range.

MAIN's `estop.coverage` field is the authoritative forward-safety result in
`LIVE` mode. It includes the bounded cache of the last valid in-sector scanner
sample while the servo is outside that sector. The backend also requires fresh,
healthy front components, but it does not infer coverage from the current
side-looking scanner value.

Current MAIN packets set `wheel.enabled` and `estop.output_enabled` to zero.
The live adapter assigns zero confidence to Hall odometry and does not integrate
wheel distance. It also distinguishes an internal stop request from a physical
relay cut. Simulated packets keep exercising both interfaces for future use.

## Camera processing state

`CameraState` reports the raw Pi stream separately from optional processing
outputs. Raw fields contain source availability, frame identity, resolution,
frame rate, and visibility metrics. Dehazing fields contain model status,
device, precision, latency, frame rate, and peak VRAM. IR fields mirror that
processing status with the `ir_` prefix.

The camera endpoints accept `view=raw`, `view=enhanced`, or `view=ir`:

```text
GET /api/camera/frame
GET /api/camera/stream
```

An IR frame is a false-color transformation of RGB luminance. It is not a
thermal measurement and carries no temperature contract.

## Simulated V2X state

`WorldState.v2x` and `GET /api/v2x/state` serialize `V2XState`. It contains:

- `protocol_version`, currently `1.0-DSRC-SIM`;
- transmit and receive counters plus simulated channel metadata;
- `V2XPeerNode` entries with pose, distance, bearing, speed, emergency state,
  RSSI estimate, and link status;
- `V2XInfrastructureNode` entries for simulated roadside units;
- active `V2IAdvisoryMessage` entries;
- a bounded list of `V2XMessage` envelopes.

`POST /api/v2x/messages/bsm` accepts a `V2VBasicSafetyMessage` and updates the
in-memory peer model. `POST /api/v2x/broadcast-advisory` accepts a
`V2IAdvisoryMessage`. Neither endpoint transmits over radio in the current V1.
Pydantic rejects unknown fields in all V2X request models.

## Units

- distance: metres;
- speed: metres per second;
- pressure: hectopascals;
- temperature: degrees Celsius;
- angles: degrees;
- timestamps: Unix milliseconds.
