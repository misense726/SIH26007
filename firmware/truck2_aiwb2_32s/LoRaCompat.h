#pragma once

// The upstream Sandeep Mistry LoRa library uses a few Arduino helpers that
// the Ai-WB2 BL602 core does not expose. The sketch-local LoRa.cpp includes it.
#include <Arduino.h>

#ifndef ESP8266
#define ESP8266 0
#endif

#ifndef ESP32
#define ESP32 0
#endif

#ifndef yield
inline void fogsenYieldCompat() {
  delay(0);
}
#define yield() fogsenYieldCompat()
#endif

#ifndef bitWrite
#define bitWrite(value, bit, bitvalue)                                      \
  ((value) = (bitvalue) ? ((value) | (static_cast<uint8_t>(1U) << (bit))) \
                        : ((value) & ~(static_cast<uint8_t>(1U) << (bit))))
#endif

#ifndef B111
#define B111 0b111
#endif

#ifndef B1000
#define B1000 0b1000
#endif
