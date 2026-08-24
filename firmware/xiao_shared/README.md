# XIAO sensor-node contract

The front and rear XIAO ESP32-C6 projects use the same acquisition loop and UART implementation from `include/FogSenXiaoNode.h`. Each node supplies only its identity, fixed-sensor field names, pins, multiplexer channels, and timing values.

## Link wiring

Each XIAO uses a dedicated 3.3 V UART link to MAIN at 115200 baud, 8 data bits, no parity, and 1 stop bit. Cross TX to RX and connect a common ground.

| Node signal | MAIN signal |
|---|---|
| FRONT D6 / GPIO16 TX | Front RX / GPIO16 |
| FRONT D7 / GPIO17 RX | Front TX / GPIO17 |
| REAR D6 / GPIO16 TX | Rear RX / GPIO26 |
| REAR D7 / GPIO17 RX | Rear TX / GPIO27 |
| Either XIAO GND | MAIN GND |

Do not connect the UART pins to 5 V logic. The firmware does not initialize Wi-Fi, Bluetooth, ESP-NOW, Zigbee, or Thread.

## Telemetry lines

Each telemetry sample is one compact JSON object followed by `\n`.

Front:

```json
{"node":"FRONT","seq":42,"ms":18120,"a":-30,"scan":1260,"fl":620,"fr":710,"ok":31}
```

Rear:

```json
{"node":"REAR","seq":43,"ms":18124,"a":25,"scan":930,"left":440,"right":510,"ok":31}
```

`seq` starts at 1 after boot and increases once per telemetry line. `ms` is the node's local `millis()` value at the start of acquisition. `a` is the servo angle relative to that scanner's own centerline. The rear node does not rotate or transform its angle into the vehicle or world frame.

A valid scanner range is 1 through 4000 mm. A valid fixed range is 1 through 2000 mm. `-1` means no valid reading is available. It never means that the path is clear. MAIN must exclude `-1` from distance calculations and degrade confidence when the live ranges needed for a decision are unavailable.

`ok` is a bitmask:

| Bit | Value | Meaning when set |
|---|---:|---|
| 0 | 1 | Scanning VL53L1X initialized and communicating |
| 1 | 2 | Fixed sensor A initialized and communicating |
| 2 | 4 | Fixed sensor B initialized and communicating |
| 3 | 8 | TCA9548A last channel selection succeeded |
| 4 | 16 | Servo PWM attached and the last PWM write succeeded |

An out-of-range or rejected optical measurement produces `-1` but does not clear the sensor bit if communication is still alive. A read timeout, a scanner with no data-ready event within 80 ms, or a failed TCA selection clears the affected bit. The node retries missing sensors every 5 seconds.

## Commands and replies

MAIN sends one ASCII command per line:

- `PING`
- `STATUS`
- `CENTER`
- `SCAN_ON`
- `SCAN_OFF`
- `SETTLE=<ms>`, accepted from 20 through 1000 ms

`CENTER` disables scanning and holds the commanded center. `SCAN_OFF` leaves the servo at its current position. In either stopped state, fixed ToFs keep updating every 100 ms and `scan` is `-1`.

All node output remains newline-delimited JSON. Replies contain `node` and `reply`, so MAIN can distinguish them from telemetry before validating telemetry fields.

```json
{"node":"FRONT","reply":"PONG","ms":19200}
{"node":"REAR","reply":"STATUS","ms":19210,"ok":31,"scan_on":1,"settle":90}
```

## State-machine timing

The scanner visits `-80, -70, ... 70, 80` degrees, then reverses without repeating an endpoint. At each settled position, the node reads the scanner, fixed sensor A, and fixed sensor B in that order. Only one TCA channel is enabled at a time.

The default servo settle period is 90 ms. The VL53L1X uses long mode and a 50 ms timing budget. Each VL53L0X uses a 20 ms timing budget. The node takes one optical measurement at a time in scanner, fixed A, fixed B order. The scanner wait is a polled state, while each fixed-sensor library call has an 80 ms timeout. All values live in the node's `node_config.h`.

## Safety boundary

These nodes acquire ranges and move one servo. They do not map, fuse sensors, calculate a safe corridor, or control the motor-cut relay. MAIN owns local deterministic safety logic. The laptop owns vehicle and world transforms.
