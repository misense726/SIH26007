# FogSen Base Station Firmware

The FogSen Base Station receives high-frequency LoRa RF telemetry from up to 2 vehicle nodes (SX1278 transceivers), aggregates their multi-sensor streams (GPS NEO-6M, HX711 5kg Load Cell, ToFs, IMU, Environment, Safety), and bridges the data over USB Serial (115200 baud) to the FogSen backend and dashboard in the standard `fogsen.main.v1` JSON wire schema.

The firmware is dual-targeted and compiles cleanly on **ESP32** or **ESP8266** (NodeMCU v2/v3 / WeMos D1 Mini).

## Architecture

```text
[Node 1: DUMPER_01] ---- LoRa 433MHz (65B Binary) ----\
                                                       +---> [Base Station: ESP32 / ESP8266] ---> USB Serial (115200) ---> PC Dashboard
[Node 2: DUMPER_02] ---- LoRa 433MHz (65B Binary) ----/
```

### High-Throughput LoRa Protocol
- **Frequency**: 433.000 MHz
- **Bandwidth**: 250 kHz
- **Spreading Factor**: SF7
- **Coding Rate**: 4/5
- **Sync Word**: `0x12`
- **Preamble Length**: 8 symbols
- **Packet Format**: 65-byte packed binary struct (`LoraTelemetryPacket`) with hardware and software CRC16 verification
- **Time-on-Air (ToA)**: ~56 ms per packet (or ~28 ms at 500 kHz), allowing multiple non-interfering transmissions per second.

## Pin Maps

### ESP32 Pinout (Recommended)

| Signal | ESP32 GPIO | Description |
|---|---|---|
| LoRa SCK | GPIO 18 | VSPI Clock |
| LoRa MISO | GPIO 19 | VSPI Data In |
| LoRa MOSI | GPIO 23 | VSPI Data Out |
| LoRa NSS / CS | GPIO 5 | Chip Select (active low) |
| LoRa RST | GPIO 4 | Radio Hardware Reset (active low) |
| LoRa DIO0 | GPIO 2 | Radio IRQ / RxDone |
| USB UART | GPIO 1 TX / GPIO 3 RX | USB Serial Bridge to PC (115200 baud) |
| Status LED | GPIO 2 | Pulses on valid LoRa packet reception |

### ESP8266 Pinout (NodeMCU / D1 Mini)

| Signal | NodeMCU / D1 Pin | ESP8266 GPIO | Description |
|---|---|---|---|
| LoRa SCK | D5 | GPIO 14 | HSPI Clock |
| LoRa MISO | D6 | GPIO 12 | HSPI Data In |
| LoRa MOSI | D7 | GPIO 13 | HSPI Data Out |
| LoRa NSS / CS | D8 | GPIO 15 | HSPI Chip Select (held LOW at boot) |
| LoRa RST | D0 | GPIO 16 | Hardware Reset (outputs HIGH at boot) |
| LoRa DIO0 | D2 | GPIO 4 | Interrupt Pin |
| USB UART | TX / RX | GPIO 1 / 3 | USB Serial Bridge to PC (115200 baud) |
| Status LED | D4 | GPIO 2 | Active-low onboard LED |

## Electrical & Power Guidelines
1. **Supply Voltage**: LoRa SX1278 requires **3.3 V**. Do NOT connect to 5 V.
2. **Decoupling**: Place a 100 nF ceramic capacitor in parallel with a 10 µF electrolytic capacitor across the SX1278 VCC and GND pins to absorb radio current spikes.
3. **Antenna**: Always attach an appropriate 433 MHz helical or whip antenna before powering the SX1278.

## Compilation & Upload

Compile for ESP32:
```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/base_station
```

Upload to ESP32:
```powershell
arduino-cli upload --port COM<X> --fqbn esp32:esp32:esp32 firmware/base_station
```

## Supported USB Commands

The Base Station accepts ASCII command lines over USB Serial:
- `STATUS` or `PING`: Returns JSON status of the Base Station and health of all tracked vehicle nodes.
