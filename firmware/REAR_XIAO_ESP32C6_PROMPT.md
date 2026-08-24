# Firmware Agent Prompt — REAR XIAO ESP32-C6

You are implementing the **FogSen REAR SENSOR NODE** firmware.

Read `FIRMWARE_CONTEXT.md` first.

Target:
**Seeed Studio XIAO ESP32-C6**

Framework:
**Arduino**

Do not use Wi-Fi/BLE.

---

# Hardware

This node owns:

1. TCA9548A I²C multiplexer
2. Rear servo-scanned VL53L1X
3. Left-side VL53L0X
4. Right-side VL53L0X
5. SG90 rear servo
6. Wired UART to MAIN ESP32

Default pins:
- SDA = D4 / GPIO22
- SCL = D5 / GPIO23
- UART TX = D6 / GPIO16
- UART RX = D7 / GPIO17
- Servo PWM = D2 / GPIO2

TCA channels:
- CH0 = rear scanning VL53L1X
- CH1 = left-side VL53L0X
- CH2 = right-side VL53L0X

Keep pins/channels in one config file.

---

# Important Rear Coordinate Convention

The rear scanner physically faces backward.

Firmware should send:
- servo angle relative to the rear sensor's centerline;
- raw ranges.

Do NOT convert to world coordinates in firmware.

The laptop mapping layer owns the sensor mounting transform.

This keeps firmware simple and avoids inconsistent coordinate logic.

---

# Development Order

Follow exactly:

## R0
Compile/boot/UART skeleton.

## R1
TCA9548A selection.

## R2
Left-side VL53L0X only.

## R3
Right-side VL53L0X.

## R4
Rear VL53L1X fixed at center.

## R5
Servo-only test.

## R6
Discrete rear scanner state machine.

Suggested angles:
`-80,-70,...,+80`, then reverse.

## R7
UART packet output.

Format:

```json
{"node":"REAR","seq":1,"ms":1234,"a":20,"scan":980,"left":430,"right":510,"ok":1}
```

## R8
Commands:
- `PING`
- `STATUS`
- `CENTER`
- `SCAN_ON`
- `SCAN_OFF`
- `SETTLE=<ms>`
- optional `SYNC=<ms>`

## R9
Fault handling and periodic retries.

---

# Reliability Rules

- external servo 5 V supply;
- common GND;
- I²C timeouts;
- no infinite waiting;
- no controller reboot because one ToF is absent;
- scanner can be disabled while fixed ToFs continue;
- UART continues health/status reporting;
- no Wi-Fi/BLE.

---

# Acceptance Test

Complete only when:

1. rear scanner sweeps reliably;
2. left/right fixed ToFs remain responsive;
3. servo movement does not reset board;
4. packets arrive continuously;
5. one failed sensor does not kill node;
6. packet structure matches FRONT node conventions;
7. rear-node identity is always explicit.

Provide:
- final wiring;
- library versions;
- build settings;
- packet examples;
- known issues.

Do not add mapping or Digital Twin logic here.
