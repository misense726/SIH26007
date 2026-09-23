# Firmware agent prompt for FRONT XIAO ESP32-C6

Implement the MI Sense FRONT sensor node. Read `FIRMWARE_CONTEXT.md` first and
keep this project wired-only.

## Fixed hardware contract

- Target: Seeed Studio XIAO ESP32-C6 with Arduino
- Scanner: one servo-mounted VL53L1X V2
- Fixed sensor: one forward-facing VL53L0X V2
- Servo: one SG90 on a separate regulated 5 V supply
- Internal link: wired UART to MAIN at 115200
- VL53LDK: unused

| Use | Pin |
|---|---|
| scanner XSHUT | D0 / GPIO0 |
| fixed-front XSHUT | D1 / GPIO1 |
| servo PWM | D2 / GPIO2 |
| SDA / SCL | D4 / GPIO22, D5 / GPIO23 |
| UART TX / RX | D6 / GPIO16, D7 / GPIO17 |

Both ToFs connect directly to the same SDA/SCL bus. Keep every pin and timing
value in `node_config.h`.

## Address sequence

At boot, drive both XSHUT pins low. Release only the scanner by changing D0 to
input, initialize it at `0x29`, set `0x30`, and probe `0x30`. Then release the
fixed sensor, initialize it at `0x29`, set `0x31`, and probe `0x31`.

Do not drive XSHUT high. If a sensor or bus operation fails, report the affected
range as `-1`, clear its health bit, keep UART running, and rerun the complete
local shutdown and address sequence. Retry persistent missing hardware at a
bounded interval.

## Acquisition behavior

Use a non-blocking servo and scanner state machine. The live profile sweeps from
-80 through +80 degrees in 5-degree steps, then reverses without repeating an
endpoint. It uses a 30 ms default settle and a 20 ms VL53L1X short-mode timing
budget. After settling, read scanner then fixed-front with a configurable
optical guard. Keep fixed-front updating when scanning is off.

Use bounded I2C and ranging timeouts. An invalid or out-of-range sample is `-1`.
Never replace it with maximum range.

## UART contract

Send one compact JSON object per line:

```json
{"node":"FRONT","seq":1,"ms":1234,"a":-30,"scan":1200,"scan_ms":1200,"front":600,"front_ms":1232,"ok":11}
```

Health bits are scanner `1`, fixed-front `2`, and servo `8`. The fully healthy
mask is `0x0B`. Support `PING`, `STATUS`, `CENTER`, `SCAN_ON`, `SCAN_OFF`, and
`SETTLE=<ms>` from 20 through 100 ms without blocking the acquisition loop.
Reject any other value with `ERROR_SETTLE_RANGE` and keep the current setting.

Packet `ms` is local packet-completion time. Each range has its own local
sample-completion `*_ms` so MAIN can calculate host-relative age.

## Completion checks

Compile for `esp32:esp32:XIAO_ESP32C6`. Then report compilation separately from
physical evidence. Bench acceptance still requires address probing, supply and
servo checks, one-sensor disconnect and reconnect tests, optical interference
testing, continuous UART packets, and a full sweep without resets.

Do not add mapping, navigation, safety decisions, wireless transport, or
laptop-side logic to this node.
