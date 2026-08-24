# Data contracts

The backend models in `backend/app/models` are canonical. Unknown fields fail validation so sensor adapters cannot silently change the contract.

Every telemetry payload includes a source mode:

- `LIVE` means a connected hardware provider produced the data;
- `SIMULATED` means the deterministic demo produced it;
- `REPLAY` means a saved recording produced it.

## M0 world state

`WorldState` contains:

- a schema version, generation timestamp, and monotonic sequence;
- one `VehiclePose`;
- normalized `RangeReading` values;
- `EnvironmentState`;
- `LiveObject` values;
- `EmergencyState`;
- per-sensor `SensorHealth`.

The HTTP endpoint `/api/world` and WebSocket endpoint `/ws/telemetry` serialize the same model.

## Units

- distance: metres;
- speed: metres per second;
- pressure: hectopascals;
- temperature: degrees Celsius;
- angles: degrees;
- timestamps: Unix milliseconds.

