# FogSen wired firmware

FogSen uses three controllers and no wireless transport:

```text
FRONT XIAO ESP32-C6 -- 115200 UART --\
                                      MAIN ESP32 -- USB serial -- laptop
REAR  XIAO ESP32-C6 -- 115200 UART --/
```

MAIN owns the relay motor cut and keeps evaluating safety if the laptop is
closed or unplugged. The XIAO boards only read their three ToF sensors and move
their scanner servos.

## First build

Run these commands from the repository root:

```powershell
.\scripts\setup-firmware.ps1
.\scripts\verify-firmware.ps1
```

The setup script pins ESP32 Arduino core 3.3.11 and every direct library. The
verification script compiles MAIN, FRONT, and REAR one at a time, then runs the
firmware and laptop protocol tests.

## Projects

- `main_esp32`: normal ESP32 DevKit or ESP32-WROOM target;
- `front_xiao_esp32c6`: front scanner and front fixed ToFs;
- `rear_xiao_esp32c6`: rear scanner and side fixed ToFs;
- `xiao_shared`: shared XIAO acquisition state machine and UART contract.

Each project has its own wiring, upload, packet, and bench-test notes in its
README.

## Controller wiring

| Link | Transmit pin | Receive pin |
|---|---|---|
| FRONT to MAIN | FRONT D6 / GPIO16 | MAIN GPIO16 |
| MAIN to FRONT | MAIN GPIO17 | FRONT D7 / GPIO17 |
| REAR to MAIN | REAR D6 / GPIO16 | MAIN GPIO26 |
| MAIN to REAR | MAIN GPIO27 | REAR D7 / GPIO17 |

Connect MAIN, both XIAOs, both TCA/ToF assemblies, relay logic, and the external
servo supply to a common ground. UART is 3.3 V logic. Do not connect any UART
pin to 5 V.

MAIN uses GPIO21/GPIO22 for its MPU6050 and BMP280 I2C bus, GPIO32/GPIO33 for
the Hall inputs, and GPIO25 for the relay input. Each XIAO uses D4/D5 for its
TCA9548A bus and D2 for servo PWM.

## Power

Power both SG90 servos from a separate regulated 5 V supply rated for at least
2 to 3 A. Add 470 to 1000 microfarads of bulk capacitance near the servo power
connection. Do not power a servo from a XIAO or ESP32 3.3 V pin. Keep motor
power away from logic wiring and join grounds deliberately.

## Polling and fail-safe timing

| Work | Rate or bound |
|---|---:|
| MAIN UART parsing | every loop, bounded byte budget |
| MAIN safety evaluation | 40 Hz |
| MAIN IMU | 50 Hz |
| MAIN Hall speed | 20 Hz |
| MAIN BMP280 | 4 Hz |
| MAIN USB telemetry | 10 Hz |
| Stale XIAO cutoff | 500 ms |
| Missing-sensor retry | 5 s |

The 10 Hz laptop rate is deliberate. A representative 862-byte packet uses
about 75 percent of a 115200-baud 8N1 link at 10 Hz; 20 Hz would exceed the
wire capacity. Local safety still runs at 40 Hz and never waits for USB.

During a scan, each XIAO settles the servo, then reads VL53L1X, fixed sensor A,
and fixed sensor B sequentially. `SCAN_OFF` keeps both fixed ToFs updating at
about 10 Hz. Missing or rejected ranges are `-1`, which always means unknown.

## Flashing

Connect and identify one board at a time with:

```powershell
arduino-cli board list
```

Then upload with the matching project and port:

```powershell
arduino-cli upload --port COM5 --fqbn esp32:esp32:XIAO_ESP32C6 firmware/front_xiao_esp32c6
arduino-cli upload --port COM6 --fqbn esp32:esp32:XIAO_ESP32C6 firmware/rear_xiao_esp32c6
arduino-cli upload --port COM8 --fqbn esp32:esp32:esp32 firmware/main_esp32
```

Replace the example ports. Flash the XIAO nodes first, then MAIN. Test the
relay with motor power disconnected and the drive wheels raised.

## Laptop cable check

Install the small serial dependency and monitor MAIN:

```powershell
.\.venv\Scripts\python.exe -m pip install pyserial
.\.venv\Scripts\python.exe -m backend.app.serial_monitor --port COM8 --send STATUS
```

The monitor validates each JSON line, separates boot and command replies, and
prints `UNKNOWN` for invalid or stale ranges. Use `--raw` for validated JSON or
`--once` for a one-packet cable test.

## What still needs hardware

Compilation proves board and library compatibility, not electrical behavior.
Before driving, verify relay polarity, Hall edge polarity, servo pulse limits,
sensor alignment, external supply stability, and a prolonged three-board UART
run. This is an RC motor-cut demonstration, not a service brake.
