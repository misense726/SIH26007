# XIAO ESP32-C6 firmware research

This note records hardware and library facts used by the FRONT XIAO sensor
node. MIDDLE has a separate ESP32-C3 fixed-sensor implementation. Links point
to board-maker, chip-maker, or library-maintainer sources.

## Board pins and build target

Seeed's XIAO ESP32-C6 pin table maps D0 to GPIO0, D1 to GPIO1, D2 to GPIO2, D3
to GPIO21, D4 to GPIO22 and SDA, D5 to GPIO23 and SCL, D6 to GPIO16 and TX, and
D7 to GPIO17 and RX. This leaves D0, D1, and D3 available for XSHUT while
preserving the servo, I2C, and UART pins. [Seeed XIAO ESP32-C6 getting
started](https://wiki.seeedstudio.com/xiao_esp32c6_getting_started/)

The Arduino CLI target is `esp32:esp32:XIAO_ESP32C6`. Seeed's PlatformIO guide
uses `board = seeed-xiao-esp32-c6` with the Arduino framework. [Seeed XIAO
ESP32-C6 PlatformIO guide](https://wiki.seeedstudio.com/xiao_esp32c6_with_platform_io/)

## UART and I2C

Arduino-ESP32 exposes `HardwareSerial::begin(baud, config, rxPin, txPin)`. The
XIAO uses an explicitly pinned `Serial1` for MAIN while USB serial remains
available for debug output. The ESP32-C3 middle node uses native UART0 through
`Serial0`: GPIO21 is TX and GPIO20 is RX. [Arduino-ESP32 UART
API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/serial.html)

Arduino-ESP32 supports explicit SDA/SCL assignment, clock selection, and a bus
timeout. FRONT uses GPIO22 and GPIO23 at 100 kHz with a 30 ms bus timeout.
MIDDLE uses GPIO4 and GPIO5 at 400 kHz with the same timeout. Both nodes clear
a stuck bus with bounded SCL pulses before restarting Wire.
[Arduino-ESP32 I2C
API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/i2c.html)

## Multiple sensors on one bus

ST application note AN4846 specifies putting all VL53L0X devices in reset,
enabling them one by one, and assigning a new address before enabling the next.
The same address-isolation rule applies to the VL53L1X scanner. [ST AN4846,
Using multiple VL53L0X in a single
design](https://www.st.com/resource/en/application_note/an4846-using-multiple-vl53l0x-in-a-single-design-stmicroelectronics.pdf)

Pololu's maintained multiple-VL53L1X example drives every XSHUT low as an
output, then releases each line with `pinMode(pin, INPUT)`. Its comment warns
against driving the carrier XSHUT pin high because the line is not level
shifted. FogSen follows that pattern. [Pololu continuous multiple sensors
example](https://github.com/pololu/vl53l1x-arduino/blob/master/examples/ContinuousMultipleSensors/ContinuousMultipleSensors.ino)

The Pololu libraries accept 7-bit addresses through `setAddress`. FogSen uses
`0x30` for the scanner, `0x31` for fixed A, and `0x32` for fixed B. Firmware
probes each address immediately after assignment. [Pololu VL53L0X Arduino
library](https://github.com/pololu/vl53l0x-arduino), [Pololu VL53L1X Arduino
library](https://github.com/pololu/vl53l1x-arduino)

ST lists a 1.2 ms maximum boot time after XSHUT release for both sensor families.
FRONT holds both sensors low for 50 ms and waits 20 ms after each release.
MIDDLE uses 10 ms for both periods. MAIN uses 2 ms for its single rear scanner.
[ST VL53L1X
datasheet](https://www.st.com/resource/en/datasheet/vl53l1x.pdf), [ST VL53L0X
datasheet](https://www.st.com/resource/datasheet/vl53l0x.pdf)

## Servo output

The ESP32-C6 has LEDC PWM channels. Arduino-ESP32 3.x provides
`ledcAttach(pin, frequency, resolution)` and `ledcWrite(pin, duty)`. A 14-bit,
50 Hz output supplies the SG90 command signal. [Arduino-ESP32 LEDC
API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html)

The 500 to 2500 microsecond pulse defaults require linkage-specific testing.
The SG90 takes power from a separate regulated 5 V rail, never from XIAO 3.3 V.

## Range sensors

ST specifies VL53L1X ranging up to 4 m. Pololu's VL53L1X 1.3.1 library supports
long mode, timing budgets, non-blocking data-ready polling, timeouts, and range
status. Both FogSen scanners use short mode with a 20 ms budget and reject
results whose status is not `RangeValid`. The fixed VL53L0X sensors also use a
20 ms timing budget. [ST VL53L1X product
page](https://www.st.com/content/st_com/en/products/imaging-and-photonics-solutions/time-of-flight-sensors/vl53l1x.html),
[Pololu VL53L1X Arduino library](https://github.com/pololu/vl53l1x-arduino)

ST's VL53L0X tables reach about 2 m only under favorable indoor conditions.
Fog, sunlight, dark targets, cover material, and geometry shorten useful range.
FogSen treats 2 m as a validation ceiling, not guaranteed detection distance.
[ST VL53L0X datasheet](https://www.st.com/resource/datasheet/vl53l0x.pdf)

## Resulting rules

- All ToFs on one node share SDA and SCL directly.
- Every active ToF has a dedicated XSHUT GPIO.
- A failed sensor is held low if initialization or address verification fails.
- Recovery reruns the complete node-local XSHUT and address sequence.
- Optical reads run sequentially with a configurable guard.
- An invalid or unavailable sample is `-1`, never maximum range.
- Servo position remains open loop until physical feedback is added.
- Real hardware must verify supply stability, address retention, optical
  interference, servo limits, and retry behavior.
