#pragma once

#include <stddef.h>
#include <stdint.h>

namespace fogsen {
namespace config {

constexpr char kFirmwareVersion[] = "0.1.0";
constexpr char kTelemetrySchema[] = "fogsen.main.v1";
constexpr char kDataMode[] = "LIVE";

// Current prototype hardware profile. Keep the Hall and relay implementations
// compiled so a later build can enable them without restoring deleted code.
constexpr bool kHallSensorsEnabled = false;
constexpr bool kMotorCutRelayEnabled = false;

constexpr uint32_t kUsbSerialBaud = 115200;
constexpr uint32_t kNodeUartBaud = 115200;
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
constexpr uint32_t kTelemetryPeriodMs = 100;
constexpr uint32_t kSensorRetryMs = 5000;
constexpr uint8_t kSensorFailureLimit = 3;

constexpr uint8_t kRearScannerI2cAddress = 0x30;
constexpr uint16_t kRearScannerReadTimeoutMs = 80;
constexpr uint32_t kRearScannerTimingBudgetUs = 50000;
constexpr uint16_t kRearScannerXshutResetUs = 2000;
constexpr uint16_t kRearScannerXshutBootUs = 2000;
constexpr int16_t kRearScanMinDeg = -80;
constexpr int16_t kRearScanMaxDeg = 80;
constexpr int16_t kRearScanStepDeg = 10;
constexpr int16_t kRearServoCenterDeg = 0;
constexpr int16_t kRearServoMinAngleDeg = -90;
constexpr int16_t kRearServoMaxAngleDeg = 90;
constexpr uint16_t kRearServoMinPulseUs = 500;
constexpr uint16_t kRearServoMaxPulseUs = 2500;
constexpr uint32_t kRearServoFrequencyHz = 50;
constexpr uint8_t kRearServoResolutionBits = 14;
constexpr uint16_t kRearDefaultSettleMs = 90;
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

constexpr size_t kTelemetryJsonCapacity = 3072;
constexpr size_t kTelemetryLineCapacity = 1500;
constexpr size_t kTransmitQueueDepth = 3;

}  // namespace config
}  // namespace fogsen

#ifndef FOGSEN_ENABLE_DEBUG_LOGS
#define FOGSEN_ENABLE_DEBUG_LOGS 0
#endif
