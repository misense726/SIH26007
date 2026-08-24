# FogSen rear XIAO ESP32-C6 firmware

This sketch runs the rear sensor node. It reads the rear scanning VL53L1X, left-side VL53L0X, and right-side VL53L0X through a TCA9548A. It moves the rear SG90 in discrete steps and streams compact JSON to MAIN over wired UART.

The rear scanner angle is relative to its backward-facing centerline. The firmware does not convert it into vehicle or world coordinates.

## Wiring

| XIAO signal | Connect to |
|---|---|
| D4 / GPIO22 SDA | TCA9548A SDA |
| D5 / GPIO23 SCL | TCA9548A SCL |
| D6 / GPIO16 TX | MAIN rear UART RX / GPIO26 |
| D7 / GPIO17 RX | MAIN rear UART TX / GPIO27 |
| D2 / GPIO2 PWM | Rear SG90 signal |
| GND | MAIN, TCA/ToF, and external servo-supply ground |

TCA channel 0 connects the rear VL53L1X. Channel 1 connects left-side VL53L0X. Channel 2 connects right-side VL53L0X.

Power the SG90 from the separate regulated 5 V supply. Do not use the XIAO 3.3 V rail. Fit the planned 470 to 1000 µF bulk capacitor near the servo supply and keep a common ground.

## Toolchain

- Espressif Arduino core 3.3.11
- Board: `XIAO_ESP32C6`
- Arduino CLI FQBN: `esp32:esp32:XIAO_ESP32C6`
- Pololu VL53L0X 1.3.1
- Pololu VL53L1X 1.3.1

Compile from the repository root:

```powershell
arduino-cli compile --fqbn esp32:esp32:XIAO_ESP32C6 firmware/rear_xiao_esp32c6
```

Upload after replacing `COM6` with the board's port:

```powershell
arduino-cli upload -p COM6 --fqbn esp32:esp32:XIAO_ESP32C6 firmware/rear_xiao_esp32c6
```

For PlatformIO:

```powershell
Set-Location firmware/rear_xiao_esp32c6
pio run
pio run --target upload --upload-port COM6
```

Set `FOGSEN_DEBUG_LOGS=0` in the build flags to remove USB debug text. The node UART always keeps telemetry enabled.

## Expected output

USB debug prints `REAR BOOT`. The MAIN UART receives a JSON boot reply followed by telemetry:

```json
{"node":"REAR","reply":"BOOT","ms":39}
{"node":"REAR","seq":1,"ms":140,"a":-80,"scan":930,"left":440,"right":510,"ok":31}
```

See `../xiao_shared/README.md` for range validity, health bits, commands, and reply formats.

## Bench check

1. Flash with the servo signal disconnected and confirm repeated clean boots.
2. Verify TCA channels 0, 1, and 2 and an `ok` value of 31 with all hardware present.
3. Power the servo from the external 5 V rail and test `CENTER` before `SCAN_ON`.
4. Watch one full sweep and confirm angles remain rear-relative and the sequence increments without resets.
5. Unplug each ToF in turn. Its range must become `-1`, its health bit must clear after a timeout, and the other sensors must keep reporting.
6. Reconnect the ToF and allow at least 5 seconds for automatic reinitialization.
7. Run `SCAN_OFF` and confirm `left` and `right` continue at roughly 10 Hz while `scan` stays `-1`.

## Known limits

The servo has no position feedback. A valid PWM write does not prove physical movement. The pulse endpoints and 90 ms settle period need linkage-specific bench calibration. Optical range depends on target reflectance, ambient infrared, cover material, and sensor alignment. No physical acceptance test has been run without the assembled node.
