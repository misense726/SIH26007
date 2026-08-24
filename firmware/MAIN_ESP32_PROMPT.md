# Firmware Agent Prompt — MAIN NORMAL ESP32

You are implementing the **FogSen MAIN VEHICLE CONTROLLER**.

Read `FIRMWARE_CONTEXT.md` first.

Target:
**Normal ESP32 DevKit / ESP32-WROOM-class board**

Framework:
**Arduino**

This is the critical controller. Keep it simple and deterministic.

Do not use Wi-Fi/BLE in V1.

---

# Hardware Responsibilities

MAIN owns:

1. UART link from FRONT XIAO C6
2. UART link from REAR XIAO C6
3. MPU6050
4. BMP280
5. Left Hall wheel sensor
6. Right Hall wheel sensor
7. Emergency-stop relay / RC motor cut
8. USB Serial to GPU laptop

Recommended pins:

### UART FRONT
- RX = GPIO16
- TX = GPIO17

### UART REAR
- RX = GPIO26
- TX = GPIO27

### I²C
- SDA = GPIO21
- SCL = GPIO22

### Hall
- Left = GPIO32
- Right = GPIO33

### Relay
- GPIO25

Keep these in `pins.h`.

Confirm no chosen pin conflicts with the exact board before final firmware.

---

# Development Order

## M0 — Skeleton

Create project that:
- boots;
- starts Serial to laptop at 115200;
- starts Front UART;
- starts Rear UART;
- prints health;
- loops safely.

Compile first.

## M1 — UART FRONT only

Parse newline packets from FRONT.

Do not use blocking `readStringUntil()` with long timeouts.

Use buffered/non-blocking line parser.

Validate:
- JSON parse
- node == FRONT
- sequence
- timestamps
- ranges

Store:
- latest packet
- receive timestamp
- health
- dropped sequence count

## M2 — UART REAR

Add identical parser/state.

Keep Front/Rear logic symmetric.

## M3 — Node stale detection

Initial stale timeout:
500 ms.

If stale:
- mark node DEGRADED/DISCONNECTED;
- do not silently trust old data.

## M4 — MPU6050

Integrate MPU.

Initial data:
- accel xyz
- gyro xyz

Do not try complex sensor fusion yet.

Expose health.

## M5 — BMP280

Integrate:
- temperature °C
- pressure hPa
- approximate relative altitude

At boot or explicit calibration command:
- store baseline pressure/altitude
- report `rel_alt_m`

Always label it relative/approximate.

## M6 — Hall sensors

Use GPIO interrupts.

Maintain volatile counters:
- left_ticks
- right_ticks

Do minimal work inside ISR:
increment counter only.

Calculate speed in main loop using configurable:
- magnets_per_wheel
- wheel_circumference_m

Do not hard-code final vehicle values.

## M7 — Consolidated laptop telemetry

Send newline-delimited JSON to USB Serial.

Example compact structure:

```json
{"ms":2000,"front":{"age":4,"a":-20,"scan":1200,"fl":610,"fr":720},"rear":{"age":6,"a":30,"scan":940,"left":440,"right":500},"imu":{"gz":1.4,"ax":0.02,"ay":-0.01},"env":{"temp":31.4,"pressure":1007.2,"rel_alt":1.1},"wheel":{"l":124,"r":126,"speed":0.31},"estop":{"state":"SAFE","cut":0}}
```

Do not make firmware wait for laptop.

## M8 — Local Emergency Stop State Machine

States:
- SAFE
- WARNING
- CRITICAL
- EMERGENCY_STOP
- SENSOR_FAULT

Inputs:
- current wheel speed
- valid nearest obstacle range from appropriate live ToFs
- direction if available/configured
- sensor freshness

Do not use camera or simulated radar.

Initial thresholds must be configurable in `safety_config.h`.

Start conservative and simple.

Example concept only:
- safe > threshold_safe
- warning < threshold_warning
- critical < threshold_critical
- emergency motor cut < threshold_stop while moving

Do not hard-code these exact distances until physical test.

## M9 — Relay

Relay output defaults to SAFE state at boot.

Make polarity configurable:
- active high / active low

Add:
- manual `ESTOP_TEST`
- `ESTOP_RESET`

Emergency stop should latch until reset if configured.

Never spam relay rapidly.

## M10 — Commands from laptop

Support:

- `STATUS`
- `ZERO_ALT`
- `RESET_TICKS`
- `ESTOP_TEST`
- `ESTOP_RESET`
- `FRONT_CENTER`
- `REAR_CENTER`
- `FRONT_SCAN_ON/OFF`
- `REAR_SCAN_ON/OFF`

Forward node commands over UART.

## M11 — Watchdog/fault behavior

System must continue if:
- laptop disconnects;
- Front node fails;
- Rear node fails;
- BMP280 fails;
- MPU6050 fails.

Emergency behavior should use available valid sensors conservatively.

Do not reboot-loop because a peripheral is missing.

---

# UART Architecture

Normal ESP32 has multiple hardware UART controllers.

Use:
- USB/default Serial -> laptop/debug
- one HardwareSerial -> FRONT
- one HardwareSerial -> REAR

Use explicit RX/TX assignment.

Do not use SoftwareSerial.

---

# Main Loop

Prefer a simple scheduler based on `millis()`.

Example logical rates:
- UART parsing: every loop
- safety evaluation: 20–50 Hz
- Hall speed calculation: 20 Hz
- MPU read: 50 Hz
- BMP280: 2–5 Hz
- laptop telemetry: 20 Hz
- health report: 1 Hz

Do not add FreeRTOS tasks unless clearly required.

---

# Acceptance Test

MAIN firmware is done only when:

1. both XIAO nodes stream simultaneously;
2. no packet parser blocks;
3. Hall ticks work while UART traffic is active;
4. IMU and BMP280 continue updating;
5. disconnecting one sensor node is detected;
6. laptop disconnection does not affect local logic;
7. relay test works;
8. emergency state machine can cut motor;
9. relay can reset safely;
10. telemetry remains stable for at least a prolonged bench test;
11. no Wi-Fi/BLE required.

Deliver:
- wiring table;
- final pin map;
- library list/versions;
- exact Arduino/PlatformIO target;
- build instructions;
- packet schema;
- bench-test checklist;
- known limitations.

Reliability is more important than cleverness.
