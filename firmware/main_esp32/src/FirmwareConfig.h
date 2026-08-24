#pragma once

#include <stddef.h>
#include <stdint.h>

namespace fogsen {
namespace config {

constexpr char kFirmwareVersion[] = "0.1.0";
constexpr char kTelemetrySchema[] = "fogsen.main.v1";
constexpr char kDataMode[] = "LIVE";

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
