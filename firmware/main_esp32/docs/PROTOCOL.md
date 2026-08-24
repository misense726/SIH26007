# MAIN firmware protocol

All links use newline-delimited UTF-8 JSON at 115200 baud. One line is one
packet. Internal node links are wired hardware UART only. Laptop transport is
the MAIN board's wired USB serial connection.

## Sensor node input

FRONT packets:

```json
{"node":"FRONT","seq":42,"ms":18120,"a":-30,"scan":1260,"fl":620,"fr":710,"ok":31}
```

REAR packets:

```json
{"node":"REAR","seq":43,"ms":18124,"a":25,"scan":930,"left":440,"right":510,"ok":31}
```

Required fields:

| Field | Type | Meaning |
|---|---|---|
| `node` | string | Exact `FRONT` or `REAR` identity |
| `seq` | unsigned 32-bit integer | Monotonic node packet sequence |
| `ms` | unsigned 32-bit integer | Node-local `millis()` timestamp |
| `a` | integer | Servo angle relative to that scanner centerline, -90 to 90 degrees |
| `scan` | integer | Scanner range in millimetres, 1 to 4000, or -1 unknown |
| `fl`, `fr` | integer | FRONT fixed ranges in millimetres, 1 to 2000, or -1 unknown |
| `left`, `right` | integer | REAR fixed ranges in millimetres, 1 to 2000, or -1 unknown |
| `ok` | integer | Health bitmask |

`0` is accepted defensively but treated as unknown. Values below -1 or above a
sensor's configured maximum reject the packet.

Health bits:

| Bit | Value | Meaning when set |
|---|---:|---|
| 0 | 1 | scanning ToF initialized and responsive |
| 1 | 2 | fixed sensor A initialized and responsive |
| 2 | 4 | fixed sensor B initialized and responsive |
| 3 | 8 | TCA9548A reachable |
| 4 | 16 | servo PWM attached |

A healthy sensor may still report `-1` for a sample with no valid target.
MAIN treats that sample as unknown. A true timeout or TCA failure also clears
the affected health bit until the node retry succeeds.

MAIN discards malformed, wrong-node, duplicate, and out-of-order packets. It
counts sequence gaps. A packet becomes stale 500 ms after MAIN receives it.
`millis()` age calculations tolerate unsigned rollover.

Node command replies are separate JSON lines:

```json
{"node":"FRONT","reply":"CENTERED"}
```

MAIN recognizes these before telemetry validation and does not replace the
latest range packet with a reply.

## Laptop output

MAIN sends a boot event, command replies, and telemetry. Every object contains a
`type`. Telemetry uses schema `fogsen.main.v1` and mode `LIVE`.

Representative telemetry:

```json
{"type":"telemetry","schema":"fogsen.main.v1","fw":"0.1.0","mode":"LIVE","seq":18,"ms":18200,"front":{"state":"HEALTHY","age":4,"seq":42,"node_ms":18120,"a":-30,"scan":1260,"fl":620,"fr":710,"ok":31,"drop":0,"ooo":0,"bad":0,"reboot":0},"rear":{"state":"HEALTHY","age":8,"seq":43,"node_ms":18124,"a":25,"scan":930,"left":440,"right":510,"ok":31,"drop":0,"ooo":0,"bad":0,"reboot":0},"imu":{"state":"HEALTHY","age":3,"ax":0.02,"ay":-0.01,"az":9.81,"gx":0.1,"gy":0.2,"gz":1.3,"err":0},"env":{"state":"HEALTHY","age":90,"temp":31.4,"pressure":1007.2,"rel_alt":1.2,"baseline":1,"err":0},"wheel":{"l":124,"r":127,"ls":0.3,"rs":0.31,"speed":0.305},"estop":{"state":"SAFE","reason":"CLEAR","direction":"FORWARD","coverage":1,"cut":0,"latched":0,"nearest":1.26,"warn":0.75,"critical":0.45,"stop":0.22,"latched_ms":0},"system":{"tx_drop":0,"json_drop":0,"cmd_overflow":0}}
```

Compact field units:

| Path | Unit or meaning |
|---|---|
| `ms`, `node_ms`, `age`, `latched_ms` | milliseconds |
| node `a` | degrees relative to scanner centerline |
| node range fields | millimetres, -1 unknown |
| `imu.ax`, `ay`, `az` | metres per second squared |
| `imu.gx`, `gy`, `gz` | degrees per second |
| `env.temp` | degrees Celsius |
| `env.pressure` | hectopascals |
| `env.rel_alt` | approximate metres relative to the BMP startup or manual baseline |
| `wheel.l`, `wheel.r` | cumulative Hall ticks since boot or `RESET_TICKS` |
| wheel speed fields | metres per second, magnitude only |
| `estop.nearest`, `warn`, `critical`, `stop` | metres |

Node states are `OFFLINE`, `HEALTHY`, `DEGRADED`, or `STALE`. Local sensor
states also include `INITIALIZING`. Emergency states are `SAFE`, `WARNING`,
`CRITICAL`, `EMERGENCY_STOP`, and `SENSOR_FAULT`.

Before the first valid sample, sensor values and ages are JSON `null`. The same
applies to relative altitude while its baseline is still being collected and to
nearest range when no positive range is available.

`backend/app/providers/serial_protocol.py` maps these values into the canonical
backend contracts:

- all six node ranges become `RangeReading` values with metre conversion;
- Hall counts and speeds populate `MotionState` and vehicle speed;
- IMU `gz` maps to `imu_yaw_rate_dps`;
- BMP values map to `EnvironmentState` with `mode=LIVE`;
- `SENSOR_FAULT` maps to a non-safe backend warning plus degraded sensor health;
- relay state maps to `EmergencyState.motor_cut`.

The adapter uses MAIN reception time for the first live version and never turns
`-1` into a maximum range. `python -m backend.app.serial_monitor --port COMx`
provides a direct cable check without starting the dashboard.

## Laptop input and replies

Commands are plain ASCII lines. MAIN answers with JSON:

```json
{"type":"command_reply","schema":"fogsen.main.v1","ms":19000,"cmd":"ESTOP_RESET","ok":0,"reason":"RESET_REQUIRES_STOPPED_VEHICLE_AND_VERIFIED_CLEAR_RANGE"}
```

The full command list is in the project README. MAIN never waits for a laptop
command or acknowledgment.
