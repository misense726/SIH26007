# FogSen firmware context

## Controller ownership

FogSen uses three controllers. Their sensor links remain wired, while MAIN
publishes the combined dashboard packet to the laptop over Wi-Fi:

- FRONT XIAO ESP32-C6 owns `front_scanner`, `front_fixed`, and the front SG90;
- MIDDLE ESP32-C3 Super Mini owns `left_side` and `right_side`;
- BACK/MAIN ESP32-WROOM owns `rear_scanner`, the rear SG90, MPU6050, BMP280,
  and laptop Wi-Fi telemetry (with USB diagnostics). Hall and motor-cut relay implementations remain in
  the firmware but are disabled in the current hardware profile.

Keep the five canonical range IDs unchanged. The backend packet still contains
`front.scan`, `front.front`, `rear.scan`, `rear.left`, and `rear.right`. MAIN
builds the `rear` object from its local scanner and the MIDDLE UART packet.

The VL53LDK remains disconnected.

## Pin contract

### FRONT XIAO ESP32-C6

| Pin | Use |
|---|---|
| D0 / GPIO0 | front scanner XSHUT |
| D1 / GPIO1 | fixed-front XSHUT |
| D2 / GPIO2 | front SG90 PWM |
| D4 / GPIO22 | SDA |
| D5 / GPIO23 | SCL |
| D6 / GPIO16 | UART TX to MAIN GPIO16 |
| D7 / GPIO17 | UART RX from MAIN GPIO17 |

### MIDDLE ESP32-C3 Super Mini

| Pin | Use |
|---|---|
| GPIO0 | fixed-left XSHUT |
| GPIO1 | fixed-right XSHUT |
| GPIO4 | SDA |
| GPIO5 | SCL |
| GPIO21 | UART TX to MAIN GPIO26 |
| GPIO20 | UART RX from MAIN GPIO27 |

Keep C3 GPIO2, GPIO8, and GPIO9 free because they are boot-strapping pins. Keep
GPIO18 and GPIO19 free for native USB.

### BACK/MAIN ESP32-WROOM

| Pin | Use |
|---|---|
| GPIO13 | rear scanner XSHUT |
| GPIO14 | rear SG90 PWM |
| GPIO21 / GPIO22 | rear scanner, MPU6050, and BMP280 SDA / SCL |
| GPIO16 / GPIO17 | FRONT UART RX / TX |
| GPIO26 / GPIO27 | MIDDLE UART RX / TX |
| GPIO32 / GPIO33 | reserved left / right Hall inputs, leave unconnected |
| GPIO25 | reserved relay motor-cut output, leave unconnected |

UART uses 115200 baud, 8 data bits, no parity, and 1 stop bit. Cross TX to RX,
use 3.3 V logic, and join all grounds. MAIN connects to the laptop's LAN TCP
listener on port `8765`; USB remains a diagnostic/upload path.

## I2C addresses and recovery

All ToFs boot at `0x29`.

| Controller | Sensor | Runtime address |
|---|---|---:|
| FRONT | front VL53L1X scanner | `0x30` |
| FRONT | fixed-front VL53L0X | `0x31` |
| MIDDLE | fixed-left VL53L0X | `0x31` |
| MIDDLE | fixed-right VL53L0X | `0x32` |
| MAIN | rear VL53L1X scanner | `0x30` |

Addresses may repeat between controllers because the buses are separate.

At boot and recovery, a controller holds every local XSHUT low. It releases one
sensor, initializes it at `0x29`, assigns and probes the runtime address, then
continues. It repeats the full local sequence after a probe or timed-read
failure. XSHUT release uses `pinMode(pin, INPUT)` so the carrier pulls the line
high.

## Timing and unknown values

FRONT reads scanner then fixed-front with a 5 ms optical guard. MIDDLE reads
left then right with the same guard. MAIN runs the rear scanner independently.
Both servo settle values default to 90 ms and accept 20 through 120 ms.

A valid scanner range is 1 through 4000 mm. A valid fixed range is 1 through
2000 mm. Missing, rejected, timed-out, or out-of-range readings are `-1`.
Unknown never means maximum range.

## Packets and health

FRONT sends:

```json
{"node":"FRONT","seq":42,"ms":18120,"a":-30,"scan":1260,"scan_ms":18070,"front":620,"front_ms":18118,"ok":11}
```

MIDDLE sends:

```json
{"node":"MIDDLE","seq":43,"ms":18124,"left":440,"left_ms":18095,"right":510,"right_ms":18122,"ok":6}
```

Global health bits remain scanner `1`, fixed A `2`, fixed B `4`, and servo `8`.
Healthy FRONT is `0x0B`. Healthy MIDDLE is `0x06`. MAIN combines healthy local
rear scanner and servo bits with fresh MIDDLE fixed bits to publish healthy
rear mask `0x0F`.

MAIN preserves per-sensor ages. Stale or missing MIDDLE data does not invalidate
a fresh rear scanner, and a failed rear scanner does not turn the side ToFs into
maximum range.

## Safety and power

Forward safety still requires the FRONT scanner and fixed-front ToF. MAIN owns
the bounded in-sector scanner cache and keeps computing warning and stop state.
The current profile does not read Hall pulses or drive the relay pin. Camera or
ML output cannot make a future motor decision.

`FirmwareConfig.h` keeps `kHallSensorsEnabled` and
`kMotorCutRelayEnabled` false. Disabled Hall pins stay as inputs with no
interrupts. The disabled relay pin stays as an input and telemetry reports that
the physical output is unavailable.

Power both SG90s from a separate regulated 5 V, 2 to 3 A supply. Add 470 to 1000
microfarads near the servo rail. Join the servo ground to all controller and
sensor grounds.

Compilation proves source and board-package compatibility only. It does not
prove pin labels, XSHUT voltage, I2C recovery, servo movement, UART wiring,
optical behavior, or power stability. Relay polarity remains untested until a
later hardware profile enables that output.
