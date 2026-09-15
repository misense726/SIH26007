#pragma once

#include <stddef.h>
#include <stdint.h>

namespace fogsen {
namespace config {

constexpr char kFirmwareVersion[] = "0.3.0";
constexpr char kTelemetrySchema[] = "fogsen.main.v1";
constexpr char kDataMode[] = "LIVE";

// Current prototype hardware profile. Keep the Hall and relay implementations
// compiled so a later build can enable them without restoring deleted code.
constexpr bool kHallSensorsEnabled = false;
constexpr bool kMotorCutRelayEnabled = false;

// MAIN keeps direct USB telemetry as the primary laptop path. LoRa mirrors a
// compact packet to the optional Base Station. Wi-Fi remains available as an
// alternate profile without replacing the wired USB path.
constexpr bool kUsbTelemetryEnabled = true;
constexpr bool kWifiTelemetryEnabled = false;
constexpr bool kLoraTelemetryEnabled = true;

constexpr uint32_t kUsbSerialBaud = 115200;
constexpr uint32_t kNodeUartBaud = 115200;
constexpr uint16_t kWifiTelemetryPort = 8765;
constexpr uint32_t kWifiReconnectMs = 3000;
constexpr uint32_t kWifiTaskStackBytes = 6144;
constexpr uint8_t kWifiTaskPriority = 1;
constexpr uint8_t kWifiTaskCore = 0;
constexpr uint32_t kI2cClockHz = 100000;
constexpr uint16_t kI2cTimeoutMs = 20;

constexpr uint32_t kNodeStaleMs = 500;
constexpr uint32_t kNodeResetWindowMs = 10000;
constexpr size_t kNodeLineCapacity = 256;
constexpr size_t kNodeBytesPerPoll = 192;
constexpr size_t kUsbCommandCapacity = 96;
constexpr size_t kUsbBytesPerPoll = 96;

constexpr uint32_t kSafetyPeriodMs = 25;
constexpr uint32_t kWheelPeriodMs = 50;
constexpr uint32_t kImuPeriodMs = 20;
constexpr uint32_t kEnvironmentPeriodMs = 250;
constexpr uint32_t kTelemetryPeriodMs = 50;
constexpr uint32_t kSensorRetryMs = 5000;
constexpr uint8_t kSensorFailureLimit = 3;

constexpr uint8_t kRearScannerI2cAddress = 0x30;
constexpr bool kRearScannerShortDistanceMode = true;
constexpr uint16_t kRearScannerReadTimeoutMs = 80;
constexpr uint32_t kRearScannerTimingBudgetUs = 20000;
constexpr uint16_t kRearScannerXshutResetUs = 2000;
constexpr uint16_t kRearScannerXshutBootUs = 2000;
constexpr int16_t kRearScanMinDeg = -80;
constexpr int16_t kRearScanMaxDeg = 80;
constexpr int16_t kRearScanStepDeg = 5;
constexpr int16_t kRearServoCenterDeg = 0;
constexpr int16_t kRearServoMinAngleDeg = -90;
constexpr int16_t kRearServoMaxAngleDeg = 90;
constexpr uint16_t kRearServoMinPulseUs = 500;
constexpr uint16_t kRearServoMaxPulseUs = 2500;
constexpr uint32_t kRearServoFrequencyHz = 50;
constexpr uint8_t kRearServoResolutionBits = 14;
constexpr uint16_t kRearDefaultSettleMs = 30;
constexpr uint16_t kRearMinimumSettleMs = 20;
constexpr uint16_t kRearMaximumSettleMs = 120;

constexpr int16_t kScannerMinMm = 1;
constexpr int16_t kScannerMaxMm = 4000;
constexpr int16_t kFixedMinMm = 1;
constexpr int16_t kFixedMaxMm = 2000;
constexpr int16_t kScannerSafetyHalfAngleDeg = 50;

constexpr float kWheelCircumferenceM = 0.22F;
constexpr uint8_t kMagnetsPerWheel = 2;
constexpr float kMaxPlausibleWheelSpeedMps = 3.0F;
constexpr uint32_t kWheelSpeedHoldMs = 750;

constexpr uint8_t kBmpBaselineSamples = 8;
constexpr float kBmpMinPressureHpa = 300.0F;
constexpr float kBmpMaxPressureHpa = 1100.0F;
constexpr float kMpuMinAccelerationNormMps2 = 2.0F;
constexpr float kMpuMaxAccelerationNormMps2 = 30.0F;
constexpr uint16_t kImuZeroSampleCount = 100;
constexpr float kImuZeroMaxGyroDps = 5.0F;
constexpr float kImuZeroMaxAccelDeltaMps2 = 0.75F;

constexpr size_t kTelemetryJsonCapacity = 4096;
constexpr size_t kTelemetryLineCapacity = 2400;
constexpr size_t kTransmitQueueDepth = 3;
constexpr size_t kWifiTransmitQueueDepth = 3;

// GPS NEO-6M Configuration
constexpr uint32_t kGpsBaud = 9600;
constexpr size_t kGpsMaxBytesPerPoll = 64;
constexpr uint32_t kGpsStaleTimeoutMs = 3000;

// HX711 5kg Load Cell Configuration
constexpr float kLoadCellDefaultCalibration = 420.0F;  // Counts per gram
constexpr uint32_t kLoadCellPeriodMs = 100;
constexpr uint32_t kLoadCellWatchdogMs = 1500;
constexpr uint8_t kLoadCellTareSamples = 10;

// LoRa SX1278 High-Throughput Configuration
constexpr long kLoraFrequency = 433E6;
constexpr long kLoraBandwidth = 250E3;
constexpr int kLoraSpreadingFactor = 7;
constexpr int kLoraCodingRate = 5;       // 4/5 coding rate
constexpr int kLoraSyncWord = 0x12;
constexpr int kLoraTxPower = 17;         // 17 dBm (PA_BOOST)
constexpr uint8_t kLoraNodeId = 1;        // Node 1 (DUMPER_01) or Node 2 (DUMPER_02)
constexpr uint32_t kLoraTxPeriodMs = 100; // 10 Hz for high data transfer rate every second
constexpr uint16_t kLoraSlotOffsetMs = 0; // Slot offset for TDMA scheduling

}  // namespace config
}  // namespace fogsen

#ifndef FOGSEN_ENABLE_DEBUG_LOGS
#define FOGSEN_ENABLE_DEBUG_LOGS 0
#endif
