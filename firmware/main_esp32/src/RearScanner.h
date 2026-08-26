#pragma once

#include <Arduino.h>
#include <VL53L1X.h>
#include <Wire.h>

namespace fogsen {

struct RearScannerReading {
  bool hasSample;
  int16_t angleDeg;
  int16_t rangeMm;
  uint32_t sampleMs;
};

class RearScanner {
 public:
  explicit RearScanner(TwoWire& wire);

  void begin(uint32_t nowMs);
  void poll(uint32_t nowMs);
  bool center(uint32_t nowMs);
  bool setScanning(bool enabled, uint32_t nowMs);
  bool setSettleMs(uint16_t settleMs);

  const RearScannerReading& reading() const { return reading_; }
  bool sensorHealthy() const { return sensorInitialized_; }
  bool servoHealthy() const { return servoHealthy_; }
  bool scanning() const { return scanEnabled_; }
  uint16_t settleMs() const { return settleMs_; }
  uint32_t sampleAgeMs(uint32_t nowMs) const;
  uint32_t failures() const { return failures_; }

 private:
  enum class Phase : uint8_t { kSettling, kWaiting };

  static bool timeReached(uint32_t nowMs, uint32_t deadlineMs);
  static bool elapsedAtLeast(uint32_t nowMs, uint32_t thenMs,
                             uint32_t durationMs);
  void holdInReset();
  void releaseFromReset();
  void configureI2cBus();
  bool probe(uint8_t address);
  bool initializeSensor(uint32_t nowMs);
  void markSensorFailed(uint32_t nowMs);
  bool writeServoAngle(int16_t angleDeg);
  void startMeasurement(uint32_t nowMs);
  void finishMeasurement(uint32_t nowMs);
  void advanceAngle();

  TwoWire& wire_;
  VL53L1X sensor_;
  RearScannerReading reading_;
  bool sensorInitialized_;
  bool servoHealthy_;
  bool scanEnabled_;
  Phase phase_;
  int8_t scanDirection_;
  int16_t currentAngleDeg_;
  int16_t pendingAngleDeg_;
  uint16_t settleMs_;
  uint32_t measurementStartedMs_;
  uint32_t nextActionMs_;
  uint32_t nextRetryMs_;
  uint32_t failures_;
};

}  // namespace fogsen
