# MAIN firmware protocol

Packets use newline-delimited UTF-8 JSON. Internal node links and the USB
fallback use 115200 baud. MAIN also sends the same telemetry to the FogSen
backend over Wi-Fi TCP. Wi-Fi targets 20 Hz; the full USB packet sustains about
10 Hz at 115200 baud.

## Sensor-node input

FRONT sends two ranges:

```json
{"node":"FRONT","seq":42,"ms":18120,"a":-30,"scan":1260,"scan_ms":18070,"front":620,"front_ms":18118,"ok":11}
```

MIDDLE sends two ranges:

```json
{"node":"MIDDLE","seq":43,"ms":18124,"left":440,"left_ms":18095,"right":510,"right_ms":18122,"ok":6}
```

| Field | Type | Meaning |
|---|---|---|
| `node` | string | exact `FRONT` or `MIDDLE` identity |
| `seq` | unsigned 32-bit integer | monotonic node packet sequence |
| `ms` | unsigned 32-bit integer | node-local packet-completion time |
| `a` | integer | FRONT scanner-relative servo angle, -90 to 90 degrees |
| `scan` | integer | FRONT scanner millimetres, 1 to 4000, or -1 unknown |
| `scan_ms` | unsigned 32-bit integer | FRONT scanner sample-completion time |
| `front` | integer | FRONT fixed millimetres, 1 to 2000, or -1 unknown |
| `front_ms` | unsigned 32-bit integer | node-local front sample-completion time |
| `left`, `right` | integer | MIDDLE fixed millimetres, 1 to 2000, or -1 unknown |
| `left_ms`, `right_ms` | unsigned 32-bit integer | node-local fixed sample-completion time |
| `ok` | integer | node-specific health bitmask |

`0` is accepted defensively but treated as unknown. Values below `-1` or above
the configured ceiling reject the packet.

Health bits:

| Bit | Value | Meaning when set |
|---|---:|---|
| 0 | 1 | scanning ToF initialized and responsive |
| 1 | 2 | fixed sensor A initialized and responsive |
| 2 | 4 | fixed sensor B initialized and responsive |
| 3 | 8 | servo PWM attached |

FRONT permits bits 0, 1, and 3. Its healthy mask is `0x0B`. MIDDLE permits bits
1 and 2. Its healthy mask is `0x06`. MAIN rejects health bits that do not belong
to that UART node. MAIN combines MIDDLE's fresh fixed bits with its local rear
scanner and servo bits to publish rear mask `0x0F`.

Forward coverage also requires valid values from both `front.scan` and
`front.front`. The scanner sample must fall inside MAIN's configured forward
sector. MAIN can retain a valid in-sector scanner sample for up to 1800 ms while
the servo sweeps outside the sector. A fresh valid `front.front` value remains
mandatory. MAIN clears retained scanner evidence on FRONT staleness, scanner or
servo health loss, node reboot, expiry, or a new in-sector invalid sample. A
healthy bit with range `-1` does not satisfy coverage.

`estop.coverage` is MAIN's final deterministic coverage decision. It includes
the retained in-sector scanner evidence described above and the current
fixed-front reading. Consumers should not recompute this safety value from the
latest raw scanner angle.

A communicating sensor may still report `-1` when an optical sample has no
valid target. A probe or timed-read failure clears its bit until the node reruns
the complete local XSHUT and address sequence.

MAIN discards malformed, wrong-node, duplicate, and out-of-order packets. It
counts sequence gaps. A packet becomes stale 500 ms after receipt. Unsigned age
calculations tolerate `millis()` rollover.

Command replies are separate JSON lines:

```json
{"node":"FRONT","reply":"CENTERED"}
```

MAIN recognizes replies before telemetry validation and does not replace the
latest range packet with a reply.

## Laptop output

MAIN sends boot events, command replies, and telemetry. Telemetry uses schema
`fogsen.main.v1` and mode `LIVE`.

Representative telemetry:

```json
{"type":"telemetry","schema":"fogsen.main.v1","fw":"0.1.0","mode":"LIVE","seq":18,"ms":18200,"front":{"state":"HEALTHY","age":4,"seq":42,"node_ms":18120,"a":-30,"scan":1260,"scan_age":54,"front":620,"front_age":6,"ok":11,"drop":0,"ooo":0,"bad":0,"reboot":0},"rear":{"state":"HEALTHY","age":8,"seq":43,"node_ms":18124,"a":25,"scan":930,"scan_age":92,"left":440,"left_age":37,"right":510,"right_age":10,"ok":15,"drop":0,"ooo":0,"bad":0,"reboot":0},"imu":{"state":"HEALTHY","age":3,"ax":0.02,"ay":-0.01,"az":9.81,"gx":0.1,"gy":0.2,"gz":1.3,"err":0},"env":{"state":"HEALTHY","age":90,"temp":31.4,"pressure":1007.2,"rel_alt":1.2,"baseline":1,"err":0},"wheel":{"enabled":0,"l":0,"r":0,"ls":0,"rs":0,"speed":0},"estop":{"state":"SAFE","reason":"CLEAR","direction":"FORWARD","coverage":1,"output_enabled":0,"cut_requested":0,"cut":0,"latched":0,"nearest":1.26,"warn":0.75,"critical":0.45,"stop":0.22,"latched_ms":0},"system":{"tx_drop":0,"json_drop":0,"cmd_overflow":0}}
```

The only range paths are:

- `front.scan`
- `front.front`
- `rear.scan`
- `rear.left`
- `rear.right`

MAIN therefore emits exactly five ranges.

| Path | Unit or meaning |
|---|---|
| `ms`, `node_ms`, `age`, `latched_ms` | milliseconds |
| `scan_age`, `front_age`, `left_age`, `right_age` | sample age in MAIN's time domain, milliseconds |
| node `a` | degrees relative to scanner centerline |
| node range fields | millimetres, -1 unknown |
| `imu.ax`, `ay`, `az` | metres per second squared |
| `imu.gx`, `gy`, `gz` | degrees per second |
| `env.temp` | degrees Celsius |
| `env.pressure` | hectopascals |
| `env.rel_alt` | approximate metres relative to the BMP baseline |
| `wheel.enabled` | 0 in the current profile; Hall fields are placeholders |
| `wheel.l`, `wheel.r` | cumulative Hall ticks |
| wheel speed fields | metres per second, magnitude only |
| `estop.output_enabled` | 0 when physical relay output is disabled |
| `estop.cut_requested` | internal safety-controller request |
| `estop.cut` | physical relay output actually applied |
| `estop.nearest`, `warn`, `critical`, `stop` | metres |

Node states are `OFFLINE`, `HEALTHY`, `DEGRADED`, or `STALE`. Local sensor
states also include `INITIALIZING`. Emergency states are `SAFE`, `WARNING`,
`CRITICAL`, `EMERGENCY_STOP`, and `SENSOR_FAULT`.

Before the first packet, ranges are `-1`, packet metadata is `null`, and node
health is `OFFLINE`. Relative altitude stays `null` until a BMP baseline exists.
Nearest range is `null` when no positive range is available.

FRONT and MIDDLE `*_ms` values share their source controller's clock with packet
`ms`. MAIN computes the wrap-safe local delta, adds UART packet age, and
publishes the resulting `*_age`. The local rear scanner already uses MAIN's
clock. The backend subtracts each age from MAIN receipt time.

The backend adapter converts all five range fields to metres and never turns
`-1` into a maximum range. When `wheel.enabled` is zero, the backend assigns
zero Hall confidence and does not integrate wheel distance. When
`estop.output_enabled` is zero, it never reports a physical motor cut.

## Laptop input and replies

Commands are plain ASCII lines. MAIN answers with JSON:

```json
{"type":"command_reply","schema":"fogsen.main.v1","ms":19000,"cmd":"ESTOP_RESET","ok":0,"reason":"RESET_REQUIRES_STOPPED_VEHICLE_AND_VERIFIED_CLEAR_RANGE"}
```

MAIN never waits for a laptop command or acknowledgment.

With the current hardware profile, `RESET_TICKS` fails with
`HALL_SENSORS_DISABLED` and `ESTOP_TEST` fails with
`RELAY_OUTPUT_DISABLED`. Neither command touches its reserved GPIO. The command
handlers remain in place for a later enabled profile.
