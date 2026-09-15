# FogSen BACK/MAIN ESP32 firmware

This project targets a normal ESP32-WROOM DevKit. It runs the rear VL53L1X and
rear SG90 locally, receives FRONT and MIDDLE telemetry over separate UARTs,
reads MPU6050, BMP280, GPS and HX711, and sends telemetry over a
direct USB serial connection. It can also mirror compact telemetry over LoRa
to the optional Base Station. Hall odometry and relay motor-cut code remain
compiled but are disabled in the current hardware profile.

The FRONT and MIDDLE controller links stay on their wired UARTs. GPS uses a
receive-only software UART on GPIO35.

## Toolchain

- board: ESP32 Dev Module;
- FQBN: `esp32:esp32:esp32`;
- Arduino ESP32 core: 3.3.11;
- UART and USB serial: 115200 baud.

Pinned direct libraries are ArduinoJson 6.21.5, Adafruit MPU6050 2.2.9,
Adafruit BMP280 Library 3.0.0, and Pololu VL53L1X 1.3.1.

```powershell
arduino-cli compile --warnings all --fqbn esp32:esp32:esp32 firmware/main_esp32
arduino-cli upload --port COM8 --fqbn esp32:esp32:esp32 firmware/main_esp32
```

Match the current board and COM port before upload.

## Pinout

| MAIN pin | Connection |
|---|---|
| GPIO13 | Rear VL53L1X XSHUT |
| GPIO14 | Rear SG90 signal |
| GPIO21 | Rear VL53L1X, MPU6050, and BMP280 SDA |
| GPIO22 | Rear VL53L1X, MPU6050, and BMP280 SCL |
| GPIO16 | UART RX from FRONT D6 / GPIO16 |
| GPIO17 | UART TX to FRONT D7 / GPIO17 |
| GPIO26 | UART RX from MIDDLE GPIO21 |
| GPIO27 | UART TX to MIDDLE GPIO20 |
| GPIO32 | Reserved left Hall input, leave unconnected |
| GPIO33 | Reserved right Hall input, leave unconnected |
| GPIO25 | Reserved motor-cut relay output, leave unconnected |
| GPIO18 | LoRa SX1278 SCK (VSPI) |
| GPIO19 | LoRa SX1278 MISO (VSPI) |
| GPIO23 | LoRa SX1278 MOSI (VSPI) |
| GPIO5 | LoRa SX1278 NSS / CS (active low) |
| GPIO4 | LoRa SX1278 RST (active low) |
| GPIO34 | LoRa SX1278 DIO0 (interrupt) |
| GPIO35 | GPS NEO-6M RX (from GPS TX) |
| GPIO36 | HX711 DOUT (Sensor VP input) |
| GPIO2 | HX711 SCK (clock output) |
| USB | Laptop serial fallback and firmware upload |
| GND | Common ground for every controller and supply |

This mapping assumes ESP32-WROOM. ESP32-WROVER can reserve GPIO16 and GPIO17
for PSRAM.

## Rear scanner

The rear VL53L1X boots at `0x29`. MAIN holds GPIO13 low, releases XSHUT,
initializes the sensor, assigns `0x30`, and probes it. A probe or timed-read
failure reports `-1`, holds the sensor in reset, and retries the full rear
sequence after five seconds.

GPIO14 drives the rear SG90 at 50 Hz. The scan runs from -80 through +80 degrees
in 5-degree steps. Servo settle defaults to 30 ms and is bounded to 20 through
120 ms. The VL53L1X uses short mode with a 20 ms timing budget because that was
the fastest bench profile that returned valid data consistently. Power the
servo from the separate regulated 5 V rail, not the ESP32.

The rear scanner shares GPIO21/GPIO22 with MPU6050 and BMP280. Their addresses
do not collide. MAIN serializes its own bus operations in the main loop.

## UART and laptop packet

FRONT sends the front scanner and fixed-front range. MIDDLE sends fixed left
and right. MAIN combines those with its local rear scanner and preserves the
existing laptop fields:

```text
front.scan  front.front  rear.scan  rear.left  rear.right
```

Healthy FRONT is mask `0x0B`. Healthy MIDDLE is `0x06`. MAIN publishes rear
mask `0x0F` only when the local rear scanner and servo are healthy and MIDDLE's
two fixed-sensor bits are fresh.

## Laptop and LoRa telemetry

USB at 115200 baud carries full `fogsen.main.v1` telemetry, commands, and
events. The SX1278 sends a compact 65-byte binary packet to the optional Base
Station, which converts it back to the same JSON wire schema for its USB link.

Wi-Fi telemetry remains compiled as an alternate profile and is disabled by
default in `FirmwareConfig.h`. Do not put Wi-Fi credentials in tracked files.

## Safety

Forward safety still requires fresh front-scanner and fixed-front evidence.
MAIN keeps the bounded in-sector front scanner cache and evaluates safety at
40 Hz. The current profile reports warnings and stop decisions but cannot cut
motor power because the relay output is disabled.

`FirmwareConfig.h` sets `kHallSensorsEnabled` and
`kMotorCutRelayEnabled` to false. GPIO32, GPIO33, and GPIO25 remain inputs. No
Hall interrupts are attached and no relay level is written. Set the flags true
only after fitting and bench-checking that hardware.

Unknown range is `-1`. Missing or stale coverage never becomes maximum range or
a clear path.

## USB commands

- `STATUS`
- `ZERO_ALT`
- `RESET_TICKS`
- `ESTOP_TEST`
- `ESTOP_RESET`
- `FRONT_CENTER`
- `FRONT_SCAN_ON`
- `FRONT_SCAN_OFF`
- `REAR_CENTER`
- `REAR_SCAN_ON`
- `REAR_SCAN_OFF`
- `MIDDLE_STATUS`
- `TARE_LOADCELL`
- `SET_CAL <factor>`

FRONT commands travel over UART. Rear commands run locally on MAIN.
`TARE_LOADCELL` initiates asynchronous zero-taring of the 5kg load cell.
`SET_CAL` updates the calibration factor without reflashing.
`MIDDLE_STATUS` requests the C3 health reply. In the current profile,
`RESET_TICKS` returns `HALL_SENSORS_DISABLED` and `ESTOP_TEST` returns
`RELAY_OUTPUT_DISABLED` without touching either reserved pin.

## Bench checklist

1. Confirm GPIO25, GPIO32, and GPIO33 remain unconnected and telemetry marks
   Hall and relay output disabled.
2. Confirm the rear scanner appears at `0x30` with MPU6050 and BMP280 still
   readable.
3. Connect FRONT and MIDDLE one at a time. Confirm each UART becomes fresh after
   packets arrive and stale after 500 ms when unplugged.
4. Sweep both servos and watch all five ages, ranges, masks, and UART counters.
5. Run for 30 minutes while checking resets and supply voltage.
6. Confirm telemetry reports Hall and relay output disabled.

Compilation does not prove these physical checks.
