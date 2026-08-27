#include "RearScanner.h"

#include "FirmwareConfig.h"
#include "Pins.h"
#include "TimeUtils.h"

namespace fogsen {

RearScanner::RearScanner(TwoWire& wire)
    : wire_(wire),
      sensor_(),
      reading_{false, 0, -1, 0},
      sensorInitialized_(false),
      servoHealthy_(false),
      scanEnabled_(true),
      phase_(Phase::kSettling),
      scanDirection_(1),
      currentAngleDeg_(config::kRearScanMinDeg),
      pendingAngleDeg_(config::kRearScanMinDeg),
      settleMs_(config::kRearDefaultSettleMs),
      measurementStartedMs_(0),
      nextActionMs_(0),
      nextRetryMs_(0),
      failures_(0) {}

bool RearScanner::timeReached(uint32_t nowMs, uint32_t deadlineMs) {
  return static_cast<int32_t>(nowMs - deadlineMs) >= 0;
}

bool RearScanner::elapsedAtLeast(uint32_t nowMs, uint32_t thenMs,
                                 uint32_t durationMs) {
  return elapsedMs(nowMs, thenMs) >= durationMs;
}

void RearScanner::holdInReset() {
  digitalWrite(pins::kRearScannerXshut, LOW);
  pinMode(pins::kRearScannerXshut, OUTPUT);
}

void RearScanner::releaseFromReset() {
  // XSHUT is not level shifted. High impedance lets the carrier pull it high.
  pinMode(pins::kRearScannerXshut, INPUT);
}

void RearScanner::configureI2cBus() {
  wire_.end();
  wire_.begin(pins::kI2cSda, pins::kI2cScl, config::kI2cClockHz);
  wire_.setTimeOut(config::kI2cTimeoutMs);
}

bool RearScanner::probe(uint8_t address) {
  wire_.beginTransmission(address);
  return wire_.endTransmission() == 0;
}

bool RearScanner::initializeSensor(uint32_t nowMs) {
  sensorInitialized_ = false;
  reading_.hasSample = false;
  reading_.rangeMm = -1;
  holdInReset();
  delayMicroseconds(config::kRearScannerXshutResetUs);
  configureI2cBus();
  releaseFromReset();
  delayMicroseconds(config::kRearScannerXshutBootUs);

  sensor_ = VL53L1X();
  sensor_.setBus(&wire_);
  sensor_.setTimeout(config::kRearScannerReadTimeoutMs);
  if (!sensor_.init()) {
    holdInReset();
    nextRetryMs_ = nowMs + config::kSensorRetryMs;
    return false;
  }
  sensor_.setAddress(config::kRearScannerI2cAddress);
  if (!probe(config::kRearScannerI2cAddress)) {
    holdInReset();
    nextRetryMs_ = nowMs + config::kSensorRetryMs;
    return false;
  }
  sensor_.setDistanceMode(config::kRearScannerShortDistanceMode
                              ? VL53L1X::Short
                              : VL53L1X::Long);
  sensor_.setMeasurementTimingBudget(config::kRearScannerTimingBudgetUs);
  sensorInitialized_ = true;
  phase_ = Phase::kSettling;
  nextActionMs_ = millis() + settleMs_;
  return true;
}

void RearScanner::markSensorFailed(uint32_t nowMs) {
  ++failures_;
  sensorInitialized_ = false;
  reading_.hasSample = true;
  reading_.angleDeg = pendingAngleDeg_;
  reading_.rangeMm = -1;
  reading_.sampleMs = nowMs;
  holdInReset();
  phase_ = Phase::kSettling;
  nextActionMs_ = nowMs + settleMs_;
  nextRetryMs_ = nowMs + config::kSensorRetryMs;
}

bool RearScanner::writeServoAngle(int16_t angleDeg) {
  if (!servoHealthy_) {
    return false;
  }
  const int16_t boundedAngle = constrain(
      angleDeg, config::kRearServoMinAngleDeg, config::kRearServoMaxAngleDeg);
  const int32_t angleSpan =
      config::kRearServoMaxAngleDeg - config::kRearServoMinAngleDeg;
  if (angleSpan <= 0) {
    return false;
  }
  const uint32_t pulseSpan =
      config::kRearServoMaxPulseUs - config::kRearServoMinPulseUs;
  const uint32_t pulseUs = config::kRearServoMinPulseUs +
      (static_cast<uint32_t>(boundedAngle - config::kRearServoMinAngleDeg) *
       pulseSpan) /
          static_cast<uint32_t>(angleSpan);
  const uint32_t pwmPeriodUs = 1000000UL / config::kRearServoFrequencyHz;
  const uint32_t maximumDuty =
      (1UL << config::kRearServoResolutionBits) - 1UL;
  const uint32_t duty = (pulseUs * maximumDuty) / pwmPeriodUs;
  if (!ledcWrite(pins::kRearServoPwm, duty)) {
    return false;
  }
  currentAngleDeg_ = boundedAngle;
  return true;
}

void RearScanner::begin(uint32_t nowMs) {
  holdInReset();
  servoHealthy_ = ledcAttach(pins::kRearServoPwm,
                             config::kRearServoFrequencyHz,
                             config::kRearServoResolutionBits);
  if (servoHealthy_) {
    servoHealthy_ = writeServoAngle(currentAngleDeg_);
  }
  if (!initializeSensor(nowMs)) {
    nextActionMs_ = millis() + settleMs_;
  }
}

void RearScanner::startMeasurement(uint32_t nowMs) {
  if (!sensorInitialized_ || !servoHealthy_ ||
      !probe(config::kRearScannerI2cAddress)) {
    markSensorFailed(nowMs);
    return;
  }
  pendingAngleDeg_ = currentAngleDeg_;
  sensor_.readSingle(false);
  measurementStartedMs_ = nowMs;
  phase_ = Phase::kWaiting;
}

void RearScanner::finishMeasurement(uint32_t nowMs) {
  const uint16_t rangeMm = sensor_.read(false);
  if (sensor_.timeoutOccurred() || !probe(config::kRearScannerI2cAddress)) {
    markSensorFailed(nowMs);
    return;
  }

  reading_.hasSample = true;
  reading_.angleDeg = pendingAngleDeg_;
  reading_.sampleMs = nowMs;
  reading_.rangeMm =
      sensor_.ranging_data.range_status == VL53L1X::RangeValid &&
              rangeMm > 0U && rangeMm <= config::kScannerMaxMm
          ? static_cast<int16_t>(rangeMm)
          : -1;

  advanceAngle();
  if (!writeServoAngle(currentAngleDeg_)) {
    servoHealthy_ = false;
  }
  phase_ = Phase::kSettling;
  nextActionMs_ = nowMs + settleMs_;
}

void RearScanner::advanceAngle() {
  if (scanDirection_ > 0) {
    if (currentAngleDeg_ >= config::kRearScanMaxDeg) {
      scanDirection_ = -1;
      currentAngleDeg_ =
          config::kRearScanMaxDeg - config::kRearScanStepDeg;
    } else {
      currentAngleDeg_ += config::kRearScanStepDeg;
    }
    return;
  }
  if (currentAngleDeg_ <= config::kRearScanMinDeg) {
    scanDirection_ = 1;
    currentAngleDeg_ =
        config::kRearScanMinDeg + config::kRearScanStepDeg;
  } else {
    currentAngleDeg_ -= config::kRearScanStepDeg;
  }
}

void RearScanner::advanceWithoutRange(uint32_t nowMs) {
  if (!scanEnabled_ || !servoHealthy_ ||
      !timeReached(nowMs, nextActionMs_)) {
    return;
  }

  advanceAngle();
  if (!writeServoAngle(currentAngleDeg_)) {
    servoHealthy_ = false;
    return;
  }
  reading_.hasSample = true;
  reading_.angleDeg = currentAngleDeg_;
  reading_.rangeMm = -1;
  reading_.sampleMs = nowMs;
  nextActionMs_ = nowMs + settleMs_;
}

void RearScanner::poll(uint32_t nowMs) {
  if (!sensorInitialized_) {
    if (timeReached(nowMs, nextRetryMs_)) {
      initializeSensor(nowMs);
    }
    if (!sensorInitialized_) {
      advanceWithoutRange(nowMs);
    }
    return;
  }
  if (!scanEnabled_) {
    return;
  }
  if (phase_ == Phase::kWaiting) {
    if (sensor_.dataReady()) {
      finishMeasurement(nowMs);
    } else if (elapsedAtLeast(nowMs, measurementStartedMs_,
                              config::kRearScannerReadTimeoutMs)) {
      markSensorFailed(nowMs);
    }
    return;
  }
  if (timeReached(nowMs, nextActionMs_)) {
    startMeasurement(nowMs);
  }
}

bool RearScanner::center(uint32_t nowMs) {
  scanEnabled_ = false;
  phase_ = Phase::kSettling;
  const bool centered = writeServoAngle(config::kRearServoCenterDeg);
  nextActionMs_ = nowMs + settleMs_;
  return centered;
}

bool RearScanner::setScanning(bool enabled, uint32_t nowMs) {
  scanEnabled_ = enabled;
  phase_ = Phase::kSettling;
  if (!enabled) {
    return true;
  }
  scanDirection_ = 1;
  const bool positioned = writeServoAngle(config::kRearScanMinDeg);
  nextActionMs_ = nowMs + settleMs_;
  return positioned;
}

bool RearScanner::setSettleMs(uint16_t settleMs) {
  if (settleMs < config::kRearMinimumSettleMs ||
      settleMs > config::kRearMaximumSettleMs) {
    return false;
  }
  settleMs_ = settleMs;
  return true;
}

uint32_t RearScanner::sampleAgeMs(uint32_t nowMs) const {
  return reading_.hasSample ? elapsedMs(nowMs, reading_.sampleMs) : UINT32_MAX;
}

}  // namespace fogsen
