# XIAO ESP32-C6 firmware research

This note records the hardware and library facts used by both FogSen XIAO sensor nodes. Sources are first-party documentation and the selected library maintainers' repositories.

## Board and build target

Seeed's XIAO ESP32-C6 pin table maps D2 to GPIO2, D4 to GPIO22 and SDA, D5 to GPIO23 and SCL, D6 to GPIO16 and TX, and D7 to GPIO17 and RX. Those mappings match the frozen FogSen pin plan. Seeed also documents `XIAO_ESP32C6` as the Arduino board variant and requires an Espressif Arduino board package newer than 3.0.0. [Seeed XIAO ESP32-C6 getting started](https://wiki.seeedstudio.com/xiao_esp32c6_getting_started/)

The Arduino CLI target is `esp32:esp32:XIAO_ESP32C6`. For PlatformIO, Seeed's own guide uses its board platform with `board = seeed-xiao-esp32-c6` and `framework = arduino`. [Seeed XIAO ESP32-C6 PlatformIO guide](https://wiki.seeedstudio.com/xiao_esp32c6_with_platform_io/)

## UART and I2C

Arduino-ESP32 exposes `HardwareSerial::begin(baud, config, rxPin, txPin)`. The ESP32-C6 has two high-performance UARTs, so USB/debug output and an explicitly pinned `Serial1` link can operate separately. [Arduino-ESP32 UART API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/serial.html)

Arduino-ESP32 supports explicit SDA/SCL assignment, I2C clock selection, and a bus timeout. The firmware uses GPIO22 and GPIO23 at 400 kHz and sets a 30 ms bus timeout before touching the multiplexer or ToFs. [Arduino-ESP32 I2C API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/i2c.html)

The TCA9548A control register uses one bit per downstream channel. A set bit connects that channel after the stop condition. Writing a one-hot byte therefore keeps only one FogSen ToF branch active at a time. [Texas Instruments TCA9548A datasheet](https://www.ti.com/lit/ds/symlink/tca9548a.pdf)

## Servo output

The ESP32-C6 has six LEDC PWM channels. Arduino-ESP32 3.x provides `ledcAttach(pin, frequency, resolution)` and `ledcWrite(pin, duty)`. A 14-bit channel can generate the 50 Hz waveform used for the SG90 command signal. [Arduino-ESP32 LEDC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html)

The 500 to 2500 microsecond pulse defaults are starting values, not a mechanical calibration. Each linkage must be checked before using the full `-80` to `80` degree scan. The servo takes power from the separate regulated 5 V rail required by `FIRMWARE_CONTEXT.md`, never from the XIAO 3.3 V pin.

## Range sensors

ST specifies VL53L1X ranging up to 4 m. The selected Pololu VL53L1X 1.3.1 library supports long mode, a configurable timing budget, a non-blocking single-shot start followed by `dataReady()` and `read(false)`, timeouts, and a `RangeValid` status. The firmware uses a 50 ms budget and rejects non-valid status results. [ST VL53L1X product page](https://www.st.com/content/st_com/en/products/imaging-and-photonics-solutions/time-of-flight-sensors/vl53l1x.html), [Pololu VL53L1X Arduino library](https://github.com/pololu/vl53l1x-arduino)

ST's VL53L0X ranging table reaches about 2 m only for favorable indoor, high-reflectance conditions. Fog, sunlight, dark targets, cover material, and geometry can shorten useful range. The selected Pololu VL53L0X 1.3.1 library supports a 20 ms minimum timing budget, single-shot readings, and a bounded read timeout. The firmware treats 2 m as a contract ceiling, not a guaranteed detection distance. [ST VL53L0X datasheet](https://www.st.com/resource/datasheet/vl53l0x.pdf), [Pololu VL53L0X Arduino library](https://github.com/pololu/vl53l0x-arduino)

## Resulting assumptions

- The TCA9548A address straps remain at the default `0x70`.
- All UART and I2C logic is 3.3 V, and every controller, ToF supply, servo supply, and MAIN share ground.
- Sensor carrier boards must be powered according to their own VIN labeling. The raw ST devices are not 5 V parts.
- Servo position is open loop. PWM success cannot prove that the horn moved or that the external 5 V rail is present.
- A rejected or out-of-range sample is unknown and is encoded as `-1`. Firmware does not replace it with the maximum range.
- Real hardware is required to tune optical timing, servo settle time, pulse endpoints, and retry behavior.
