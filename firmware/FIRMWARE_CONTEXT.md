# FogSen Firmware Context

## Frozen controller topology

FogSen V1 uses exactly three critical microcontrollers:

1. **MAIN — normal ESP32 DevKit / ESP32-WROOM-class board**
2. **FRONT NODE — Seeed Studio XIAO ESP32-C6 #1**
3. **REAR NODE — Seeed Studio XIAO ESP32-C6 #2**

The Ai-Thinker Ai-WB2-32S-Kit is **not used in the critical path**. It is BL602-based, not ESP32-based, and would introduce another SDK/toolchain. Keep it as a spare/future experimental node.

Two ESP32-C3 Super Mini boards are also spares.

The goal is reliability and easy debugging.

---

# 1. Communications

Use **wired UART** between sensor nodes and the main ESP32.

Do not use Wi-Fi, BLE or ESP-NOW for internal vehicle communication.

### FRONT XIAO C6
- UART TX: D6 / GPIO16
- UART RX: D7 / GPIO17

### REAR XIAO C6
- UART TX: D6 / GPIO16
- UART RX: D7 / GPIO17

### MAIN ESP32
Use two hardware UARTs with explicit pin assignment.

Recommended initial pin plan:
- Front UART RX = GPIO16
- Front UART TX = GPIO17
- Rear UART RX = GPIO26
- Rear UART TX = GPIO27
- Main USB/Serial = laptop/debug

If the exact ESP32 board exposes different pins, preserve the logical mapping and choose safe exposed GPIOs. Avoid flash/strapping pins.

Initial baud:
`115200`

Only increase baud after the system is stable.

All UART links require common GND.

---

# 2. Power

Do NOT power servos from the XIAO 3.3 V rail.

Use a separate regulated 5 V servo supply capable of handling both servos comfortably.

Recommended:
- 5 V buck converter
- at least 2 A, preferably 3 A
- common ground between servo supply and all controllers

Add local bulk capacitance near servo power:
- approximately 470–1000 µF electrolytic

Keep motor power and logic power separated as much as practical.

The relay controls RC motor power for the emergency-stop simulation.

---

# 3. Front Node Hardware

XIAO ESP32-C6 #1:

- TCA9548A I²C multiplexer
- VL53L1X front scanning sensor
- VL53L0X front-left sensor
- VL53L0X front-right sensor
- front SG90 servo

Recommended XIAO pins:
- SDA = D4 / GPIO22
- SCL = D5 / GPIO23
- UART TX = D6 / GPIO16
- UART RX = D7 / GPIO17
- Servo PWM = D2 / GPIO2 initially

TCA channels:
- CH0 = front VL53L1X
- CH1 = front-left VL53L0X
- CH2 = front-right VL53L0X

---

# 4. Rear Node Hardware

XIAO ESP32-C6 #2:

- TCA9548A I²C multiplexer
- VL53L1X rear scanning sensor
- VL53L0X left-side sensor
- VL53L0X right-side sensor
- rear SG90 servo

Recommended pins:
- SDA = D4 / GPIO22
- SCL = D5 / GPIO23
- UART TX = D6 / GPIO16
- UART RX = D7 / GPIO17
- Servo PWM = D2 / GPIO2 initially

TCA channels:
- CH0 = rear VL53L1X
- CH1 = left-side VL53L0X
- CH2 = right-side VL53L0X

---

# 5. Main ESP32 Hardware

Normal ESP32:

- UART from FRONT node
- UART from REAR node
- MPU6050
- BMP280
- left Hall wheel sensor
- right Hall wheel sensor
- emergency-stop relay / motor cut
- USB serial to laptop

Recommended pins:
- I²C SDA = GPIO21
- I²C SCL = GPIO22
- Hall left = GPIO32
- Hall right = GPIO33
- Relay = GPIO25
- Front UART RX/TX = GPIO16/GPIO17
- Rear UART RX/TX = GPIO26/GPIO27

These are initial defaults and must live in one configuration header.

---

# 6. Design Principle

Sensor nodes do only sensor acquisition and servo scanning.

They do NOT:
- map;
- run Digital Twin logic;
- run visibility AI;
- calculate safe corridor;
- make global navigation decisions.

The MAIN ESP32:
- receives sensor-node packets;
- reads IMU/BMP280/Hall;
- timestamps/validates node data;
- performs local deterministic emergency-stop logic;
- forwards consolidated telemetry to laptop.

The laptop:
- mapping;
- Digital Twin;
- driver dashboard;
- supervisor dashboard;
- camera processing;
- dehazing;
- spatial visualization.

---

# 7. UART Protocol

Use newline-delimited compact JSON during the first working version.

Do not optimize into binary until everything is stable.

Front example:

```json
{"node":"FRONT","seq":42,"ms":18120,"a":-30,"scan":1260,"fl":620,"fr":710,"ok":1}
```

Rear example:

```json
{"node":"REAR","seq":43,"ms":18124,"a":25,"scan":930,"left":440,"right":510,"ok":1}
```

Main-to-laptop example:

```json
{
  "ms":18200,
  "front":{"a":-30,"scan":1260,"fl":620,"fr":710,"age":4},
  "rear":{"a":25,"scan":930,"left":440,"right":510,"age":8},
  "imu":{"gz":1.3,"ax":0.02,"ay":-0.01},
  "env":{"temp":31.4,"pressure":1007.2,"rel_alt":1.2},
  "wheel":{"left":124,"right":127},
  "estop":{"state":"SAFE","cut":false}
}
```

Keep lines reasonably short.

Use one packet per line.

---

# 8. Packet Robustness

Each node packet must contain:
- node ID
- sequence number
- node millis
- measurements
- health flag

Main ESP32 must track:
- last receive time
- dropped/out-of-order sequence counts
- stale-node timeout

Initial stale timeout:
`500 ms`

Do not reuse stale sensor values indefinitely.

---

# 9. Time Strategy

For V1, start simple:

- sensor nodes timestamp using local `millis()`
- main timestamps reception time
- main periodically sends a sync message if needed later

Do NOT implement complex clock synchronization before basic telemetry is stable.

Mapping software can initially use main reception timestamps because the RC car moves slowly.

Add explicit clock sync only after the base system works.

---

# 10. Servo Scan Strategy

Do not attempt smooth continuous 180° scanning first.

Start discrete.

Suggested scanner angles:
`-80, -70, -60 ... 0 ... +60, +70, +80`

Then reverse direction.

At each position:
1. command servo;
2. allow short settle delay;
3. select scanner TCA channel;
4. read ToF;
5. send packet.

Keep fixed ToFs updated between scanner steps.

Servo angles and delays must be configurable.

---

# 11. ToF Cross-Talk

Do not read all optical ToFs simultaneously.

Per node:
1. scanner reading
2. fixed sensor A
3. fixed sensor B

Use TCA channel selection and sequential reads.

If interference appears, add configurable inter-measurement delay.

---

# 12. Emergency Stop

Emergency-stop logic lives on MAIN ESP32 so it can work even if the laptop crashes.

V1 emergency action:
**relay-controlled motor cut**

Call it:
**Automatic Emergency Stop Simulation**

Never claim this is a production service/hydraulic brake.

Use only deterministic valid live range + speed data.

Initial logic must be conservative and configurable.

Never trigger solely from:
- camera ML;
- dehazed image;
- simulated radar;
- BMP280.

---

# 13. Firmware Build Policy

Use Arduino framework for all three critical controllers.

Keep each firmware in its own project/folder.

Required:
- no dynamic task complexity until needed;
- no Wi-Fi;
- no BLE;
- no cloud;
- no FreeRTOS task architecture unless simple loop/state machine proves insufficient;
- no blocking delays longer than necessary;
- watchdog-friendly loops;
- serial logging that can be disabled with a compile-time flag.

Prefer straightforward state machines.

The firmware must compile before new features are added.

---

# 14. Libraries

The coding agent should choose stable Arduino-compatible libraries that compile for the specific board.

Preferred concepts:
- `Wire`
- TCA9548A direct channel selection or a lightweight stable library
- VL53L0X library
- VL53L1X library
- servo PWM library/API verified on ESP32-C6
- MPU6050 library
- Adafruit BMP280 or equivalent
- ArduinoJson on MAIN if needed

Do not assume a library supports ESP32-C6 without compiling it.

---

# 15. Reliability Requirements

Every firmware project must:
- boot even if one sensor is absent;
- report missing sensors instead of reboot-looping;
- retry initialization periodically;
- continue sending health packets;
- use timeouts for I²C/range reads;
- never wait forever for UART input;
- never let logging block safety logic;
- expose sensor health.

The purpose is a demo that keeps running even when one peripheral is unhappy.
