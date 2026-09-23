# Hardware

MI Sense V1 keeps five ToFs and three wired controllers:

1. FRONT, a Seeed XIAO ESP32-C6 with the front scanner, fixed-front ToF, and
   front SG90;
2. MIDDLE, an ESP32-C3 Super Mini with the fixed left and right ToFs;
3. BACK/MAIN, a normal ESP32-WROOM DevKit with the rear scanner, rear SG90,
   MPU6050, BMP280, and host USB connection. Hall and relay pins are reserved
   but unused in the current build.

The canonical sensor IDs remain `front_scanner`, `front_fixed`,
`rear_scanner`, `left_side`, and `right_side`.

The dashboard's default layout follows the vehicle drawing: the front scanner is
inside the front edge and faces forward on its servo; the fixed front sensor is
at the nose and points about 50 degrees down; the left and right fixed sensors
point about 50 degrees down; and the rear scanner is at the back, facing
straight rearward on its servo. In the vehicle frame these are yaw/pitch
`(0, 0)`, `(0, -50)`, `(-90, -50)`, `(90, -50)`, and `(180, 0)` degrees in
sensor order. The Settings page exposes these display values for calibration.

## FRONT XIAO ESP32-C6

| XIAO pin | Connection |
|---|---|
| D0 / GPIO0 | Front VL53L1X scanner XSHUT |
| D1 / GPIO1 | Fixed-front VL53L0X XSHUT |
| D2 / GPIO2 | Front SG90 signal |
| D4 / GPIO22 | Front ToF SDA |
| D5 / GPIO23 | Front ToF SCL |
| D6 / GPIO16 | UART TX to MAIN GPIO16 |
| D7 / GPIO17 | UART RX from MAIN GPIO17 |
| 3V3 | VIN/VCC on both ToF carriers when the carrier accepts 3.3 V |
| GND | Both ToF GND pins, servo ground, and common controller ground |

The scanner uses runtime address `0x30`. The fixed-front ToF uses `0x31`.
Connect the SG90 red wire to the external regulated 5 V rail, brown or black to
common ground, and orange or yellow to D2. Do not connect the servo's red wire
to XIAO 3V3.

## MIDDLE ESP32-C3 Super Mini

Use the GPIO labels printed on the board. Do not treat them as XIAO D-pin
numbers.

| C3 pin | Connection |
|---|---|
| GPIO0 | Fixed-left VL53L0X XSHUT |
| GPIO1 | Fixed-right VL53L0X XSHUT |
| GPIO4 | Left and right ToF SDA |
| GPIO5 | Left and right ToF SCL |
| GPIO21 | UART TX to MAIN GPIO26 |
| GPIO20 | UART RX from MAIN GPIO27 |
| 3V3 | VIN/VCC on both ToF carriers when the carrier accepts 3.3 V |
| GND | Both ToF GND pins and common controller ground |

The left ToF uses runtime address `0x31`. The right ToF uses `0x32`.

GPIO2, GPIO8, and GPIO9 are ESP32-C3 boot-strapping pins. GPIO8 commonly also
drives the board LED. GPIO18 and GPIO19 carry native USB. Leave these pins free.
The installed Arduino target is
`esp32:esp32:esp32c3:CDCOnBoot=cdc` from Espressif core 3.3.11.

ESP32-C3 Super Mini boards come from several vendors. Before soldering, confirm
that the board silkscreen exposes GPIO0, GPIO1, GPIO4, GPIO5, GPIO20, and
GPIO21.

## BACK/MAIN ESP32-WROOM

| MAIN pin | Connection |
|---|---|
| GPIO13 | Rear VL53L1X scanner XSHUT |
| GPIO14 | Rear SG90 signal |
| GPIO21 | Rear VL53L1X, MPU6050, and BMP280 SDA |
| GPIO22 | Rear VL53L1X, MPU6050, and BMP280 SCL |
| GPIO16 | UART RX from FRONT GPIO16 |
| GPIO17 | UART TX to FRONT GPIO17 |
| GPIO26 | UART RX from MIDDLE GPIO21 |
| GPIO27 | UART TX to MIDDLE GPIO20 |
| GPIO32 | Reserved left Hall input, leave unconnected |
| GPIO33 | Reserved right Hall input, leave unconnected |
| GPIO25 | Reserved motor-cut relay output, leave unconnected |
| 3V3 | Rear ToF, MPU6050, and BMP280 power when each carrier accepts 3.3 V |
| USB | Data connection to the Raspberry Pi or computer |
| GND | Common controller, sensor, UART, and servo ground |

The rear scanner uses runtime address `0x30`. MPU6050 uses `0x68` or `0x69`.
BMP280 uses `0x76` or `0x77`, so all three devices can share GPIO21/GPIO22.

This plan targets ESP32-WROOM. ESP32-WROVER boards can reserve GPIO16 and
GPIO17 for PSRAM, so check the module marking before assembly.

### BACK/MAIN module connections

| Module | Module pin | Connect to MAIN |
|---|---|---|
| Rear VL53L1X | SDA | GPIO21 |
| Rear VL53L1X | SCL | GPIO22 |
| Rear VL53L1X | XSHUT | GPIO13 |
| Rear VL53L1X | VIN/VCC and GND | 3V3 and common GND, if the carrier is rated for 3.3 V |
| MPU6050 | SDA and SCL | GPIO21 and GPIO22 |
| MPU6050 | AD0 | GND for address `0x68`, or 3V3 for `0x69` |
| BMP280 | SDA and SCL | GPIO21 and GPIO22 |
| BMP280 | SDO | GND for address `0x76`, or 3V3 for `0x77` |
| Rear SG90 | signal | GPIO14 |
| Rear SG90 | red and brown/black | External regulated 5 V and common GND |
| Future left Hall sensor | OUT | GPIO32 |
| Future right Hall sensor | OUT | GPIO33 |
| Future relay module | IN | GPIO25 |

Do not connect Hall modules or a relay in the current build. The firmware keeps
GPIO32, GPIO33, and GPIO25 as high-impedance inputs. A later profile can enable
their existing implementations. At that point, power each module only within
the voltage range printed on it. ESP32 GPIO is not 5 V tolerant, so any output
that can rise to 5 V needs a 3.3 V pull-up, level shifter, or transistor
interface.

## ESP-to-ESP UART wiring

| Link | Wire |
|---|---|
| FRONT to MAIN | FRONT D6 / GPIO16 TX to MAIN GPIO16 RX |
| MAIN to FRONT | MAIN GPIO17 TX to FRONT D7 / GPIO17 RX |
| MIDDLE to MAIN | MIDDLE GPIO21 TX to MAIN GPIO26 RX |
| MAIN to MIDDLE | MAIN GPIO27 TX to MIDDLE GPIO20 RX |
| Common reference | FRONT GND, MIDDLE GND, and MAIN GND joined |

The UART links use 115200 baud and 3.3 V logic. Cross TX to RX. Do not connect
any UART pin to 5 V or to an RS-232 port. FRONT and MIDDLE do not connect
directly to each other.

MAIN queues each dashboard telemetry frame to both its Wi-Fi TCP client and
USB serial connection. The backend can consume either link or both together.
FRONT-to-MAIN and
MIDDLE-to-MAIN remain wired UART links. The controller chain does not use BLE
or ESP-NOW.

## ToF startup and recovery

Every controller connects its local ToFs directly to one SDA/SCL bus. No I2C
multiplexer is installed. At boot and after a sensor or bus fault, firmware:

1. drives every local XSHUT line low;
2. clears the local I2C bus when the controller supports bus recovery;
3. releases one XSHUT line by changing the GPIO to input mode;
4. initializes that sensor at default address `0x29`;
5. assigns and probes its runtime address;
6. repeats for the next local sensor.

FRONT sequences its scanner and fixed-front sensor. MIDDLE sequences left and
right. MAIN repeats the same reset and address check for its single rear
scanner. A missing, timed-out, or rejected range is `-1`, which means unknown.
Firmware never substitutes maximum range.

The current fast live profile uses 5-degree scanner steps, 30 ms servo settle,
and 20 ms VL53L1X short-mode measurements. It is a near-field prototype profile.
Use a separately validated long-mode profile if the installation needs longer
range.

The VL53LDK remains disconnected.

## Power

Power the two SG90 servos from a separate regulated 5 V supply rated for at
least 2 A, preferably 3 A. Add 470 to 1000 microfarads near the servo rail.
Never power a servo from an ESP32 3.3 V pin. Join the servo supply ground to the
controller grounds.

Power each ToF carrier according to its VIN label and keep I2C logic at 3.3 V.
Hall and relay bench checks apply only after enabling the future hardware
profile.

## Physical checks still required

1. Confirm the exact WROOM module and C3 Super Mini pin labels.
2. Confirm FRONT responds at `0x30` and `0x31`.
3. Confirm MIDDLE responds at `0x31` and `0x32`.
4. Confirm MAIN's rear scanner responds at `0x30`, alongside MPU6050 and
   BMP280.
5. Confirm GPIO32, GPIO33, and GPIO25 remain unconnected and are reported
   disabled.
6. Pull each XSHUT low and confirm only its sensor becomes unknown.
7. Force a sensor timeout and confirm that controller reruns its local address
   sequence.
8. Sweep both servos while reading all fixed ToFs and check for interference,
   stale packets, resets, and false clear ranges.
9. Run both UART links for at least 30 minutes.

Pin restrictions come from the [official Seeed XIAO ESP32-C6 pin map](https://wiki.seeedstudio.com/xiao_esp32c6_getting_started/)
and Espressif's [ESP32-C3 GPIO documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32c3/api-reference/peripherals/gpio.html).
The XSHUT sequence follows ST's [multiple VL53L0X application note](https://www.st.com/resource/en/application_note/an4846-using-multiple-vl53l0x-in-a-single-design-stmicroelectronics.pdf)
and Pololu's [multiple VL53L1X example](https://github.com/pololu/vl53l1x-arduino/blob/master/examples/ContinuousMultipleSensors/ContinuousMultipleSensors.ino).
