# FogSen wired firmware

FogSen uses three controllers and no wireless transport:

```text
FRONT XIAO ESP32-C6 ------- 115200 UART -------\
                                                    BACK/MAIN ESP32 -- USB -- laptop
MIDDLE ESP32-C3 Super Mini - 115200 UART -------/
```

BACK/MAIN also reads the local rear scanner and moves its servo. MAIN keeps
evaluating safety when the laptop is disconnected. Hall odometry and relay
motor-cut code remain available but are disabled in the current profile.

## Projects

- `front_xiao_esp32c6`: front scanner, fixed-front ToF, and front SG90;
- `middle_esp32c3_supermini`: fixed left and right ToFs;
- `main_esp32`: rear scanner, rear SG90, sensor aggregation, safety, and USB;
- `xiao_shared`: the FRONT scanner and fixed-ToF state machine.

Run the full build from the repository root:

```powershell
.\scripts\setup-firmware.ps1
.\scripts\verify-firmware.ps1
```

## Controller links

| Link | Wire |
|---|---|
| FRONT to MAIN | FRONT D6 / GPIO16 TX to MAIN GPIO16 RX |
| MAIN to FRONT | MAIN GPIO17 TX to FRONT D7 / GPIO17 RX |
| MIDDLE to MAIN | MIDDLE GPIO21 TX to MAIN GPIO26 RX |
| MAIN to MIDDLE | MAIN GPIO27 TX to MIDDLE GPIO20 RX |

Use 115200-baud 3.3 V UART and cross TX to RX. Join FRONT, MIDDLE, MAIN, sensor,
and servo-supply grounds. FRONT and MIDDLE have no direct data link.

## Pin summary

FRONT uses D0 scanner XSHUT, D1 fixed-front XSHUT, D2 SG90, D4/D5 I2C, and
D6/D7 UART.

MIDDLE uses GPIO0 left XSHUT, GPIO1 right XSHUT, GPIO4/GPIO5 I2C, and
GPIO21/GPIO20 UART TX/RX. Leave C3 GPIO2, GPIO8, GPIO9, GPIO18, and GPIO19 free.

MAIN uses GPIO13 rear-scanner XSHUT, GPIO14 rear SG90, GPIO21/GPIO22 for the
rear scanner plus MPU6050 and BMP280. GPIO32/GPIO33 remain reserved for future
Hall inputs and GPIO25 remains reserved for a future relay. Leave all three
unconnected in this build.

See [docs/HARDWARE.md](../docs/HARDWARE.md) for the full wiring and power map.

## Addressing and timing

FRONT assigns `0x30` to its scanner and `0x31` to fixed-front. MIDDLE assigns
`0x31` to left and `0x32` to right. MAIN assigns `0x30` to its rear scanner.
The buses are separate, so repeated addresses are valid.

Each controller holds its local ToFs in XSHUT, releases and addresses them one
at a time, probes the runtime addresses, and repeats the local sequence after a
fault. FRONT and MIDDLE read local ToFs sequentially. MAIN's rear scan runs
independently. Unknown range is `-1`.

## Upload

Identify one board at a time:

```powershell
arduino-cli board list
```

Upload with the matching FQBN and current COM port:

```powershell
arduino-cli upload --port COM5 --fqbn esp32:esp32:XIAO_ESP32C6 firmware/front_xiao_esp32c6
arduino-cli upload --port COM6 --fqbn "esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio,FlashFreq=40" firmware/middle_esp32c3_supermini
arduino-cli upload --port COM8 --fqbn esp32:esp32:esp32 firmware/main_esp32
```

Flash FRONT and MIDDLE first, then MAIN. Do not reuse an old COM number without
matching the connected USB device.

## Power and physical checks

Power both SG90s from a separate regulated 5 V, 2 to 3 A supply. Add 470 to
1000 microfarads near the servo rail. Do not power a servo from a controller
3.3 V pin.

Compilation does not prove the board silkscreen, XSHUT voltage, address
recovery, sensor alignment, servo movement, UART wiring, optical interference,
or supply stability. Hall and relay checks apply only after enabling that
future profile. Run the bench checks in each project README before driving.
