# Truck 2 Ai-WB2 GPS/LoRa firmware

This sketch targets the Ai-Thinker Ai-WB2-32S-Kit (BL602). It reads NMEA
sentences from a NEO-6 at 9600 baud and sends compact newline-free JSON over an
SX1278 at 433 MHz. The radio profile matches the existing ESP8266 base station:
sync word `0x12`, spreading factor 7, 125 kHz bandwidth, coding rate 4/5,
preamble 8, and CRC enabled.

The packet identity is `node: "TRUCK_2"`. A missing or stale GPS fix stays
unknown in the packet. The sender prints each packet over USB for local testing.

## Pin map

| Device | Ai-WB2 label |
|---|---|
| SX1278 SCK | IO3 |
| SX1278 MOSI | IO12 |
| SX1278 MISO | IO5 |
| SX1278 NSS/CS | IO4 |
| SX1278 RESET | IO14 |
| SX1278 DIO0 | unused, polling is used |
| NEO-6 TX | IO11, UART1 RX |
| NEO-6 RX | unused |
| Grounds | common GND |

UART1 TX uses IO17 but stays unconnected. IO3, IO14, and IO17 also connect to
the board's RGB LEDs. Do not run an RGB animation on these pins. The board's
USB UART pins IO7 and IO16 remain available for upload and diagnostics.

Use a regulated 3.3 V supply for the radio. Attach the SX1278 antenna before
transmitting. The GPS breakout's supply voltage must match its own board
specification.

## Compile and upload

The installed isolated Arduino core exposes the BL602 board as
`aithinker:wb2:aithinker_wb2_12f`. The core is shared by the Ai-WB2 BL602
variants even though its board label names the 12F profile.

```powershell
$cli = 'C:\Users\niran\.local\bin\arduino-cli.cmd'
& $cli compile --warnings all --fqbn 'aithinker:wb2:aithinker_wb2_12f:xtal=40M,boardsize=2M' firmware/truck2_aiwb2_32s
& $cli upload --port COM14 --fqbn 'aithinker:wb2:aithinker_wb2_12f:xtal=40M,boardsize=2M' firmware/truck2_aiwb2_32s
```

Rediscover the port before uploading. Hold BOOT, tap RST, then release BOOT
before running the upload. After successful flashing, tap RST to run the sketch.
The package uploader uses a 2 MB partition layout; the sketch stays within that
layout even when the board has more physical flash.

The sketch includes Sandeep Mistry's LoRa 0.8.0 source under `src`, with its MIT
license. `LoRaCompat.h` supplies helpers absent from the BL602 core. A register
transport callback permits software SPI when the hardware driver cannot read
the SX1278 identity. The installed global library is unchanged.

Firmware 0.1.1 first probes hardware SPI and then software SPI on the same pins.
The SX1278 identity register should return `0x12`. The selected bus appears as
`LORA_BUS`. If both probes fail, the sketch keeps GPS running and retries the
radio without transmitting. In the current bench test both buses returned
`0x00` and initialization failed. GPS serial reception worked, without a
satellite fix. See `BENCH_RESULTS.md` for the verified results.

A successful compile or upload does not prove the radio wiring or GPS fix.
Watch USB for `LORA_READY` and `LORA_TX_OK`. The base station must print a matching
`node` and `seq` to prove reception. `GPS bytes` counts UART input and `sentences`
counts checksum-valid NMEA sentences. Neither alone proves a GPS fix.

The old station may print the packet and then reject it as missing `miner_id`.
That proves radio reception only. The MI Sense base sketch forwards the raw
`fogsen.lora.v1` packet; MI Sense's existing `fogsen.main.v1` TCP parser still needs
a separate GPS/fleet adapter before these packets can drive the dashboard.
