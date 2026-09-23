# MI Sense front XIAO ESP32-C6 firmware

This node reads one servo-mounted VL53L1X V2 scanner and one fixed forward
VL53L0X V2. Both sensors share the local SDA/SCL bus and have separate XSHUT
pins. The node moves its SG90 in discrete steps and streams compact JSON to MAIN
over wired UART.

## Wiring

| XIAO signal | Connection |
|---|---|
| D0 / GPIO0 | scanner VL53L1X XSHUT |
| D1 / GPIO1 | fixed-front VL53L0X XSHUT |
| D2 / GPIO2 | front SG90 signal |
| D4 / GPIO22 SDA | SDA on both ToFs |
| D5 / GPIO23 SCL | SCL on both ToFs |
| D6 / GPIO16 TX | MAIN front UART RX / GPIO16 |
| D7 / GPIO17 RX | MAIN front UART TX / GPIO17 |
| 3V3 or carrier-rated VIN | ToF carrier power, according to the carrier label |
| GND | MAIN, both ToFs, and servo-supply ground |

Leave D3 unused. Do not connect the VL53LDK.

The scanner receives runtime address `0x30`; fixed-front receives `0x31`.
Firmware holds both XSHUT lines low, releases and addresses one sensor at a
time, probes each assigned address, and repeats the full sequence after a bus
or sensor recovery. Recovery also clocks a stuck I2C bus clear before Wire is
restarted. The front bus runs at 100 kHz, XSHUT stays low for 50 ms, and each
sensor gets 20 ms to boot. Releasing XSHUT uses GPIO input mode; firmware never
drives an XSHUT line high.

Power the SG90 from a separate regulated 5 V supply. Do not use the XIAO 3.3 V
rail. Fit a 470 to 1000 microfarad capacitor near the servo feed and keep a
common ground.

## Toolchain

- Espressif Arduino core 3.3.11
- Board `XIAO_ESP32C6`
- Arduino CLI FQBN `esp32:esp32:XIAO_ESP32C6`
- Pololu VL53L0X 1.3.1
- Pololu VL53L1X 1.3.1

Compile from the repository root:

```powershell
arduino-cli compile --fqbn esp32:esp32:XIAO_ESP32C6 firmware/front_xiao_esp32c6
```

Upload after replacing `COM5` with the board's port:

```powershell
arduino-cli upload -p COM5 --fqbn esp32:esp32:XIAO_ESP32C6 firmware/front_xiao_esp32c6
```

Set `FOGSEN_DEBUG_LOGS=0` in the build flags to remove USB debug text. Node UART
telemetry remains enabled.

## Expected output

USB debug prints `FRONT BOOT`. MAIN receives a boot reply and two range fields:

```json
{"node":"FRONT","reply":"BOOT","ms":41}
{"node":"FRONT","seq":1,"ms":142,"a":-80,"scan":1260,"scan_ms":111,"front":620,"front_ms":140,"ok":11}
```

`ok=11`, or `0x0B`, means scanner, fixed-front, and servo are healthy. A range
of `-1` is unknown. It never means maximum distance or a clear path.
`scan_ms` and `front_ms` are XIAO-local sample-completion times. Packet `ms` is
the XIAO-local completion time for the full packet.

See `../xiao_shared/README.md` for commands, timing, and health behavior.

## Physical bench checks

These checks have not been completed by compilation:

1. Flash with the servo signal disconnected and confirm repeated clean boots.
2. Verify D0 and D1 both start low. Confirm the sensors answer at `0x30` and
   `0x31`, with no device left at `0x29`.
3. Confirm `ok=11` with both ToFs and the servo connected.
4. Power the SG90 from the external 5 V rail and test `CENTER` before
   `SCAN_ON`.
5. Watch a full sweep. Confirm the angle and sequence advance without resets.
6. Disconnect each ToF in turn. Its range must become `-1`, its health bit must
   clear after a communication failure, and the node must keep sending packets.
7. Reconnect the ToF. Confirm the complete XSHUT and address sequence restores
   `0x30` and `0x31` after the retry period.
8. Run `SCAN_OFF`. Confirm `front` continues updating while `scan` stays `-1`.
9. Check for optical cross-talk, then tune the 5 ms inter-sensor guard if
   needed.

## Known limits

The live profile uses 5-degree steps, a 30 ms settle period, VL53L1X short mode,
and a 20 ms timing budget. This favors fast, reliable prototype near-field
ranging over the longer reach of long mode. The servo has no position feedback;
a successful PWM write does not prove that the horn moved. Calibrate the pulse
endpoints and settle period against the final linkage. Target reflectance,
ambient infrared, cover material, and alignment affect range.
