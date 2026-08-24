# FogSen MAIN ESP32 firmware

This project runs the low-level FogSen vehicle controller on a normal ESP32
DevKit with an ESP32-WROOM-class module. It reads the FRONT and REAR sensor
nodes over separate wired UARTs, samples the MPU6050 and BMP280, counts Hall
pulses, applies the local motor-cut state machine, and sends newline-delimited
JSON to the laptop over USB serial.

It does not use Wi-Fi, Bluetooth, BLE, ESP-NOW, cloud services, mapping, or
Digital Twin code.

The relay implements the **Automatic Emergency Stop Simulation**. It removes
RC motor power. It is not a production service brake.

## Toolchain

The verified Arduino CLI target is:

- board: ESP32 Dev Module;
- FQBN: `esp32:esp32:esp32`;
- ESP32 Arduino core: `3.3.11`;
- USB serial and both node links: `115200 8N1`.

Pinned direct libraries:

- ArduinoJson `6.21.5`;
- Adafruit MPU6050 `2.2.9`;
- Adafruit BMP280 Library `3.0.0`.

Arduino Library Manager installs Adafruit BusIO and Adafruit Unified Sensor as
dependencies.

Install and compile from this directory:

```powershell
arduino-cli core install esp32:esp32@3.3.11
arduino-cli lib install "ArduinoJson@6.21.5"
arduino-cli lib install "Adafruit MPU6050@2.2.9"
arduino-cli lib install "Adafruit BMP280 Library@3.0.0"
arduino-cli compile --fqbn esp32:esp32:esp32 .
```

Upload after replacing `COM7` with the board port:

```powershell
arduino-cli upload --fqbn esp32:esp32:esp32 --port COM7 .
```

PlatformIO users can open this directory and run:

```powershell
pio run
pio run --target upload
pio device monitor --baud 115200
```

`platformio.ini` uses the official `esp32dev` board definition and pins every
direct dependency.

## Wiring

| MAIN ESP32 | Connection | Other endpoint |
|---|---|---|
| GPIO16 RX | FRONT UART data in | FRONT D6 / GPIO16 TX |
| GPIO17 TX | FRONT UART command out | FRONT D7 / GPIO17 RX |
| GPIO26 RX | REAR UART data in | REAR D6 / GPIO16 TX |
| GPIO27 TX | REAR UART command out | REAR D7 / GPIO17 RX |
| GPIO21 | I2C SDA | MPU6050 SDA and BMP280 SDA |
| GPIO22 | I2C SCL | MPU6050 SCL and BMP280 SCL |
| GPIO32 | left Hall input | left Hall digital output |
| GPIO33 | right Hall input | right Hall digital output |
| GPIO25 | motor-cut request | relay module logic input |
| 3.3 V | logic power where supported | MPU6050, BMP280, Hall logic |
| GND | common reference | both XIAOs, sensors, relay logic, servo supply |

Cross each UART TX to the other board's RX. All three controllers need a common
ground. Do not power a servo or the RC motor from an ESP32 rail. Keep motor and
servo power separate from logic power, then join the grounds at a deliberate
common point.

GPIO16 and GPIO17 are suitable for the specified ESP32-WROOM target. Some
ESP32-WROVER boards reserve them for PSRAM. Confirm the module marking and pin
exposure before wiring a different board.

## Relay setup

`src/SafetyConfig.h` defaults to an active-high relay. Confirm the actual relay
module before connecting motor power. For an active-low module, set
`kRelayActiveHigh` to `false` and rebuild.

GPIO25 is driven to the configured non-cut level before it becomes an output.
Hardware still needs an external pull-down for an active-high relay, or an
external pull-up for an active-low relay, so the relay stays inactive during
reset and flashing. Test first with the drive wheels raised and the motor supply
disconnected. A separate physical stop switch remains necessary.

The cut latches by default. `ESTOP_RESET` releases it only when:

- calculated speed is at most `0.03 m/s`;
- the configured travel direction has fresh range coverage;
- at least one valid positive range is available;
- the nearest valid range is beyond the current warning threshold.

The controller refuses a blind reset. An `ESTOP_TEST` always latches the relay.

## Safety behavior

The V1 Hall hardware counts pulses but does not report direction. This build is
explicitly configured for forward travel in `src/SafetyConfig.h`. Forward safety
uses the fresh FRONT packet, requires the TCA and both fixed sensor health bits,
and also uses scanner samples within 50 degrees of the front centerline.

Every `-1` or `0` range is unknown. The firmware never substitutes a sensor's
maximum range. If usable forward coverage disappears while the vehicle is
moving, state becomes `SENSOR_FAULT`; the motor cut latches after 750 ms of the
continuous fault. A stationary controller reports the fault but leaves the
relay in its normal state. This lets the bench boot with missing sensors without
starting a relay cycle.

With valid coverage, thresholds grow with speed. The warning and critical
distances include reaction and braking terms. A valid obstacle inside the stop
distance must persist for 350 ms while moving before the relay latches. A close
obstacle while stationary reports `CRITICAL` but does not pulse the relay.

The defaults mirror `config/safety.yaml` and `config/vehicle.yaml`. Firmware
configuration is compile-time for V1. Rebuild after calibration changes.

## Laptop commands

Send one ASCII command per line over the same USB serial port:

- `STATUS`
- `ZERO_ALT`
- `RESET_TICKS`
- `ESTOP_TEST`
- `ESTOP_RESET`
- `FRONT_CENTER`
- `REAR_CENTER`
- `FRONT_SCAN_ON`
- `FRONT_SCAN_OFF`
- `REAR_SCAN_ON`
- `REAR_SCAN_OFF`

Replies are JSON lines with `type=command_reply`. Node commands are forwarded as
the short command names defined by the FRONT and REAR firmware.

## Runtime behavior

The main loop has no delay and no FreeRTOS task layer. It polls both UARTs and
USB input with byte budgets, evaluates safety at 40 Hz, updates wheel speed at
20 Hz, reads the IMU at 50 Hz, samples the BMP280 at 4 Hz, and queues laptop
telemetry at 10 Hz. USB output drains in small non-blocking chunks. A slow or
closed laptop connection can drop telemetry frames, but it cannot stop local
safety evaluation.

The BMP280 baseline uses eight valid startup readings. Until then,
`env.rel_alt` is `null`. `ZERO_ALT` replaces the baseline with the latest valid
pressure. The value is approximate relative altitude only.

The MPU6050 and BMP280 may be absent at boot. The controller reports them
offline and retries every five seconds. I2C operations use a 20 ms bus timeout.
Neither sensor can trigger the motor cut.

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for packet fields and units.

## Bench test checklist

1. Leave motor power disconnected. Flash MAIN and confirm one `boot` JSON line.
2. Confirm GPIO25 is at the relay's non-cut level during normal running.
3. Connect FRONT only. Confirm FRONT becomes healthy and REAR remains offline.
4. Connect REAR. Stream both nodes for at least 30 minutes and watch `drop`,
   `ooo`, `bad`, and `system.tx_drop`.
5. Unplug each node in turn. Its state must become `STALE` after 500 ms.
6. Exercise both Hall sensors while UART traffic continues. Confirm tick counts
   and speed update without resets.
7. Unplug and reconnect the MPU6050 and BMP280. MAIN must keep running and retry.
8. Send every center and scan command. Confirm the node reply counter advances.
9. With wheels raised, send `ESTOP_TEST`. Confirm relay cut and a latched state.
10. Confirm `ESTOP_RESET` fails with an unsafe range, then succeeds only after a
    valid clear range and near-zero speed.
11. Generate a persistent close FRONT range while the wheels turn. Confirm
    `CRITICAL` precedes the latched `EMERGENCY_STOP`.
12. Stop reading USB serial. Confirm Hall, UART, sensors, and relay behavior keep
    running locally.

## Known limits

- No hardware bench was attached during implementation. Relay polarity, Hall
  edge polarity, I2C addresses, and GPIO exposure still need physical checks.
- Direction is a forward-only configuration because the two Hall inputs provide
  pulse counts without quadrature direction.
- Hall speed is coarse at very low speed with two magnets per 0.22 m wheel. The
  estimator holds the last observed speed for 750 ms to avoid an unsafe instant
  drop to zero between pulses.
- The relay latch is held in RAM. A controller reset returns GPIO25 to the
  configured normal state. A real vehicle needs an external fail-safe interlock.
- The laptop adapter validates and converts MAIN packets, and the included
  serial monitor proves the wired link. The dashboard still starts in simulated
  mode until a live runtime selector is added.
- A no-target range is unknown by contract. Persistent insufficient coverage
  while moving stops the prototype instead of declaring the path clear.
