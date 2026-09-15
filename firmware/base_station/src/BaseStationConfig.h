#pragma once

#include <stddef.h>
#include <stdint.h>

namespace fogsen {
namespace base_station {

constexpr char kFirmwareVersion[] = "0.2.0";
constexpr char kTelemetrySchema[] = "fogsen.main.v1";
constexpr char kDataMode[] = "LIVE";

constexpr uint32_t kUsbSerialBaud = 115200;

// LoRa SX1278 RF Parameters (Identical to Vehicle Transmitters)
constexpr long kLoraFrequency = 433E6;
constexpr long kLoraBandwidth = 250E3;
constexpr int kLoraSpreadingFactor = 7;
constexpr int kLoraCodingRate = 5;       // 4/5 coding rate
constexpr int kLoraSyncWord = 0x12;
constexpr int kLoraPreambleLength = 8;

// Pin Configurations for ESP32 and ESP8266
#if defined(ESP32)
constexpr int kLoraSck = 18;
constexpr int kLoraMiso = 19;
constexpr int kLoraMosi = 23;
constexpr int kLoraCs = 5;
constexpr int kLoraRst = 4;
constexpr int kLoraDio0 = 2;
constexpr int kStatusLed = 2;  // Onboard LED
#elif defined(ESP8266)
// NodeMCU / Wemos D1 Mini pinout
constexpr int kLoraSck = 14;   // D5 (GPIO14)
constexpr int kLoraMiso = 12;  // D6 (GPIO12)
constexpr int kLoraMosi = 13;  // D7 (GPIO13)
constexpr int kLoraCs = 15;    // D8 (GPIO15)
constexpr int kLoraRst = 16;   // D0 (GPIO16)
constexpr int kLoraDio0 = 4;   // D2 (GPIO4)
constexpr int kStatusLed = 2;  // D4 (GPIO2, active low onboard LED)
#else
#error "Unsupported architecture: compile for ESP32 or ESP8266"
#endif

// Multi-Node Fleet Parameters
constexpr uint8_t kMaxTrackedNodes = 2;
constexpr uint32_t kNodeStaleMs = 1500;
constexpr size_t kJsonCapacity = 3072;
constexpr size_t kLineCapacity = 1500;

}  // namespace base_station
}  // namespace fogsen
