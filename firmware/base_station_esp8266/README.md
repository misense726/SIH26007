# MI Sense ESP8266 LoRa base station

The base station listens for the same SX1278 profile used by truck 2 and
prints packets to USB. If configured, it also forwards each received JSON line
over a TCP connection to the MI Sense computer listener on port `8765`.

The current connected COM6 station already reports `LoRa listening...`; leave
that image in place for the first radio test. This sketch is available inside
MI Sense for the later replacement once `wifi_secrets.h` and the backend packet
adapter are configured.

## Wemos D1 mini pin map

| SX1278 pin | ESP8266 label |
|---|---|
| SCK | D5 |
| MISO | D6 |
| MOSI | D7 |
| NSS/CS | D8 |
| RESET | D0 |
| DIO0 | D1 |
| VCC/GND | regulated 3.3 V/common GND |

The pin map matches the existing station firmware. Attach the antenna before
transmitting.

Copy `wifi_secrets.example.h` to `wifi_secrets.h` and set the computer's LAN
address before uploading this replacement. Do not commit credentials.
