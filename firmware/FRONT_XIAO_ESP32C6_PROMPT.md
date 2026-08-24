# Firmware Agent Prompt — FRONT XIAO ESP32-C6

You are implementing the **FogSen FRONT SENSOR NODE** firmware.

Read `FIRMWARE_CONTEXT.md` first and follow it exactly.

Target:
**Seeed Studio XIAO ESP32-C6**

Framework:
**Arduino**

Do not add Wi-Fi/BLE.

---

# Hardware

This node owns:

1. TCA9548A I²C multiplexer
2. Front servo-scanned VL53L1X
3. Front-left VL53L0X
4. Front-right VL53L0X
5. SG90 front servo
6. Wired UART to MAIN ESP32

Default pins:
- SDA = D4 / GPIO22
- SCL = D5 / GPIO23
- UART TX = D6 / GPIO16
- UART RX = D7 / GPIO17
- Servo PWM = D2 / GPIO2

TCA channels:
- CH0 = scanning VL53L1X
- CH1 = front-left VL53L0X
- CH2 = front-right VL53L0X

Keep all pin/channel assignments in one config header.

---

# Development Order

## F0 — Compile-only skeleton

Create a minimal project that:
- boots;
- starts USB debug Serial;
- starts node UART;
- prints `FRONT BOOT`;
- loops without blocking.

Compile for XIAO ESP32-C6 before doing anything else.

## F1 — TCA9548A

Implement:
- I²C initialization;
- `selectTcaChannel(uint8_t ch)`;
- scan/health output.

Prove all expected channels are selectable.

## F2 — One fixed VL53L0X

Integrate front-left only.

Requirements:
- timeout;
- invalid-range handling;
- health state;
- no reboot if missing.

## F3 — Second fixed VL53L0X

Add front-right.

Alternate reads:
- FL
- FR

Prove both operate reliably.

## F4 — Scanning VL53L1X without servo

Integrate scanner on CH0.

Keep servo fixed at 0°.

Prove scanner range is stable.

## F5 — Servo only

Implement servo position control separately.

Test:
- -80°
- 0°
- +80°

Do not scan yet.

Servo must use external 5 V power with common ground.

## F6 — Discrete scanner state machine

Create scan sequence:

`-80,-70,...,0,...,+70,+80`

then reverse.

For each angle:
1. command servo;
2. settle;
3. read VL53L1X;
4. read FL;
5. read FR;
6. send one compact UART packet.

No long blocking loop.

Use state machine / millis timing.

## F7 — UART packets

Send newline-delimited JSON:

```json
{"node":"FRONT","seq":1,"ms":1234,"a":-30,"scan":1200,"fl":600,"fr":700,"ok":1}
```

Fields:
- `node`
- `seq`
- `ms`
- `a` angle degrees
- `scan` scanner mm, null/-1 on invalid
- `fl` mm
- `fr` mm
- `ok` bitmask or overall health

Keep packet under control.

Initial baud:
115200.

## F8 — Commands from MAIN

Support simple line commands:

- `PING`
- `STATUS`
- `CENTER`
- `SCAN_ON`
- `SCAN_OFF`
- `SETTLE=<ms>`
- optional `SYNC=<ms>` later

Replies must be clear and non-blocking.

## F9 — Fault handling

If one ToF fails:
- mark it failed;
- continue other sensors;
- periodically retry initialization;
- continue UART health packets.

If servo command fails logically, scanner data should be marked degraded.

---

# Acceptance Test

Firmware is complete only when:

1. it boots repeatedly without manual intervention;
2. all three ToFs can run;
3. servo scans front sector;
4. no controller reset occurs during servo movement;
5. UART packets arrive continuously at 115200;
6. unplugging one ToF does not kill the node;
7. reconnect/retry works or at minimum health status updates correctly;
8. packet sequence is monotonic;
9. no Wi-Fi/BLE is used.

At the end, provide:
- wiring table;
- library list and versions;
- PlatformIO/Arduino IDE board config;
- compile result;
- serial example;
- known limitations.

Do not start optimization until the above works.
