#pragma once

#include <stddef.h>
#include <stdint.h>

namespace fogsen {
namespace basestation {

// ============================================================================
// Microcontroller Pin Configuration
// ============================================================================
#if defined(ESP32)

#define FOGSEN_PLATFORM_NAME "ESP32"

// ESP32 Hardware VSPI and LoRa SX1278 pinout
constexpr uint8_t kLoraSckPin   = 18;  // VSPI SCK
constexpr uint8_t kLoraMisoPin  = 19;  // VSPI MISO
constexpr uint8_t kLoraMosiPin  = 23;  // VSPI MOSI
constexpr uint8_t kLoraCsPin    = 5;   // NSS / Chip Select
constexpr uint8_t kLoraResetPin = 14;  // RST / Reset
constexpr uint8_t kLoraDio0Pin  = 26;  // DIO0 / RxDone Interrupt

// Visual status LED
constexpr uint8_t kLedPin       = 2;   // Onboard Blue LED on ESP32 DevKit
constexpr bool kLedActiveHigh   = true;

#elif defined(ESP8266)

#define FOGSEN_PLATFORM_NAME "ESP8266"

// ESP8266 NodeMCU v2 / D1 Mini Hardware SPI and LoRa SX1278 pinout
// D5 = GPIO 14 (SCK), D6 = GPIO 12 (MISO), D7 = GPIO 13 (MOSI)
// D8 = GPIO 15 (NSS), D0 = GPIO 16 (RST),  D1 = GPIO 5 (DIO0)
constexpr uint8_t kLoraSckPin   = 14;  // D5 (SCK)
constexpr uint8_t kLoraMisoPin  = 12;  // D6 (MISO)
constexpr uint8_t kLoraMosiPin  = 13;  // D7 (MOSI)
constexpr uint8_t kLoraCsPin    = 15;  // D8 (NSS / CS)
constexpr uint8_t kLoraResetPin = 16;  // D0 (RST / Reset)
constexpr uint8_t kLoraDio0Pin  = 5;   // D1 (DIO0 / Interrupt)

// Visual status LED (NodeMCU onboard LED is GPIO 2 / D4, active-low)
constexpr uint8_t kLedPin       = 2;   // D4
constexpr bool kLedActiveHigh   = false;

#else
#error "Unsupported microcontroller platform: firmware must be compiled for ESP32 or ESP8266"
#endif

// ============================================================================
// SX1278 LoRa Radio Parameters
// ============================================================================
constexpr long     kLoraFrequencyHz       = 433E6;  // 433.0 MHz (standard SX1278 band)
constexpr uint8_t  kLoraSyncWord          = 0x12;   // Private network sync word
constexpr uint8_t  kLoraSpreadingFactor   = 7;      // SF7: optimal range vs airtime (~40ms)
constexpr long     kLoraSignalBandwidth   = 125E3;  // 125 kHz bandwidth
constexpr uint8_t  kLoraCodingRate4       = 5;      // 4/5 coding rate
constexpr int8_t   kLoraTxPowerDbm        = 17;     // 17 dBm transmit power
constexpr bool     kLoraEnableCrc         = true;   // Hardware payload CRC check

// ============================================================================
// Telemetry Wire Protocol Contract ('fogsen.main.v1')
// ============================================================================
constexpr char     kFirmwareVersion[]     = "0.2.0-base";
constexpr char     kTelemetrySchema[]     = "fogsen.main.v1";
constexpr char     kDataMode[]            = "LIVE";
constexpr uint32_t kUsbBaud               = 115200;

// ============================================================================
// Timing and Node Tracking Configuration
// ============================================================================
constexpr uint32_t kTelemetryPeriodMs     = 100;    // 10 Hz USB serial output rate
constexpr uint32_t kNodeStaleTimeoutMs    = 2500;   // 2.5s without packet -> mark STALE
constexpr uint8_t  kMaxNodes              = 2;      // Node 1 (FRONT) and Node 2 (REAR)
constexpr uint32_t kSequenceResetGap      = 10000;  // Gap threshold for node reboot detection

// ============================================================================
// Range and Safety Thresholds
// ============================================================================
constexpr int16_t  kScannerMaxMm          = 4000;   // 4.0 metres ceiling
constexpr int16_t  kFixedMaxMm            = 2000;   // 2.0 metres ceiling
constexpr float    kWarningDistanceM      = 0.75F;  // Warning distance threshold
constexpr float    kCriticalDistanceM     = 0.45F;  // Critical distance threshold
constexpr float    kEmergencyDistanceM    = 0.22F;  // Emergency stop threshold

// ============================================================================
// Memory & Buffer Limits (sized safely for both ESP32 and ESP8266)
// ============================================================================
constexpr size_t   kLoRaPacketCapacity    = 256;    // SX1278 hardware FIFO capacity
constexpr size_t   kJsonDocCapacity       = 2560;   // StaticJsonDocument buffer size
constexpr size_t   kLineBufferCapacity    = 1536;   // Serial line output buffer size
constexpr size_t   kCmdBufferCapacity     = 96;     // Serial input command buffer size

}  // namespace basestation
}  // namespace fogsen
