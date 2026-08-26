# MIDDLE ESP32-C3 Super Mini

MIDDLE reads the fixed left and fixed right VL53L0X V2 sensors. It has no
servo. Both sensors share one local I2C bus and each sensor has its own XSHUT
wire.

## Pinout

| ESP32-C3 pin | Connection |
|---|---|
| GPIO0 | Fixed left VL53L0X XSHUT |
| GPIO1 | Fixed right VL53L0X XSHUT |
| GPIO4 | Both ToFs SDA |
| GPIO5 | Both ToFs SCL |
| GPIO21 | UART TX to MAIN GPIO26 |
| GPIO20 | UART RX from MAIN GPIO27 |
| 3V3 or carrier VIN | ToF carrier power, according to the carrier label |
| GND | Sensor and common controller ground |

GPIO2, GPIO8, and GPIO9 are ESP32-C3 boot-strapping pins. GPIO8 commonly also
drives the Super Mini LED. GPIO18 and GPIO19 carry native USB. This firmware
does not use those pins.

The left sensor uses runtime address `0x31`. The right sensor uses `0x32`.
Firmware holds both XSHUT lines low, releases and addresses the sensors one at a
time, probes each address, and repeats the full sequence after a sensor or bus
fault. A failed reading is `-1`, never maximum range.

## Build and upload

The project uses Espressif's generic ESP32-C3 Dev Module definition from core
3.3.11. USB CDC is enabled for the Super Mini USB connector.

```powershell
arduino-cli compile --warnings all --fqbn "esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio,FlashFreq=40" firmware/middle_esp32c3_supermini
arduino-cli upload --port COM8 --fqbn "esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio,FlashFreq=40" firmware/middle_esp32c3_supermini
```

Replace `COM8` after matching the connected board with `arduino-cli board
list`. Use Pololu VL53L0X 1.3.1.

## Bench checks

1. Confirm your board silkscreen exposes GPIO0, GPIO1, GPIO4, GPIO5, GPIO20,
   and GPIO21. ESP32-C3 Super Mini boards are sold by several vendors.
2. Confirm only `0x31` and `0x32` respond after boot. The default `0x29`
   address must be absent.
3. Pull each XSHUT low in turn and confirm only that side becomes unknown.
4. Disconnect one sensor and confirm the complete address sequence retries.
5. Run the UART link and both sensors for at least 30 minutes before mounting.
