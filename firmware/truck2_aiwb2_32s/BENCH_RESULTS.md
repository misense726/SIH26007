# Truck 2 bench results

## 2026-09-09

The isolated Arduino CLI compiled the truck sketch with
`aithinker:wb2:aithinker_wb2_12f:xtal=40M,boardsize=2M`.
It reported 193,828 bytes of program storage and 5,672 bytes of global data.
Warnings came from the upstream LoRa switch and four BL602 SDK header macros.
The core's memory report is not a measurement of peak runtime memory use.

Upload to the connected CH340 on COM14 completed at 04:51:46 local time.
The loader completed its handshake, wrote the firmware and partition data,
verified the written SHA256 values, and reported `Program Finished` and
`[All Success]`. The detected flash ID was `c8401680`, corresponding to a 4 MB
part; this build uses the package's 2 MB partition layout.

The uploader waited about 60 seconds at `Please Press Reset Key!` before the
successful handshake. That message by itself does not mean flashing failed.
After flashing, the board needs an RST press with BOOT released to start the
sketch. An eight-second capture before that reset contained no truck output.

After RST, the installed 0.1.0 sketch ran on COM14. At uptime 20,680 ms it had
received 4,009 GPS bytes and 120 checksum-valid NMEA sentences. GPS serial
communication on IO11 is verified. It reported zero satellites and no fix, so
latitude, longitude, speed, and altitude remained null.

The radio repeatedly reported `LORA_INIT_FAILED`; sequence stayed zero. A
second capture reproduced that failure while GPS sentences continued to arrive.
The COM6 ESP8266 station reported a ready radio and `rx=0`. Its firmware has not
been replaced. No over-the-air transmission or reception has been verified.

Firmware 0.1.1 adds hardware and software SPI identity probes on the existing
wires, plus a software SPI fallback. This is intended to distinguish a driver
problem from wiring, supply, or radio hardware. It compiled to 194,702 bytes
of program storage and 5,672 bytes of global data. Upload to COM14 completed
at 04:58:51 with matching flash hashes and `[All Success]`.

After reset, both identity probes repeatedly returned `0x00`:
`LORA_HW_VERSION=0x0`, `LORA_SW_VERSION=0x0`, followed by
`LORA_INIT_FAILED hardware_and_software_SPI`. The expected identity is `0x12`.
At uptime 22,703 ms GPS had delivered 4,306 bytes and 132 checksum-valid
sentences, with zero satellites and no fix. Sequence remained zero. COM6
reported `lora_ready=true` and `packets_received=0` during the same capture.
The fallback did not resolve the failure. Wiring, supply, reset level, and
module identity need physical inspection; no individual cause is proven.

The FogSen replacement base-station sketch also compiled with
`esp8266:esp8266:nodemcuv2`: 250,480 bytes of flash code, 28,408 bytes of global
RAM and 60,267 bytes of the instruction-memory region including its reserved
cache. It has not been uploaded. Wi-Fi forwarding is disabled until local
credentials and a PC address are supplied. The GPS/fleet packet adapter for
the FogSen backend is still outstanding.
