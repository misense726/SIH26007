#include "LoadCellDriver.h"
#include <math.h>
#include "TimeUtils.h"

namespace fogsen {

LoadCellDriver::LoadCellDriver(uint8_t doutPin, uint8_t sckPin)
    : doutPin_(doutPin),
      sckPin_(sckPin),
      calibrationFactor_(kDefaultCalibrationFactor),
      tareOffset_(0),
      status_(LoadCellStatus::kOffline),
      tareState_(TareState::kIdle),
      tareSamplesTarget_(0),
      tareSamplesCollected_(0),
      tareAccumulator_(0),
      reading_{false, 0, 0, 0.0F, 0.0F},
      readCount_(0),
      faultCount_(0),
      lastReadyMs_(0),
      nextWatchdogCheckMs_(0) {}

void LoadCellDriver::begin(uint32_t nowMs) {
  pinMode(doutPin_, INPUT);
  pinMode(sckPin_, OUTPUT);
  digitalWrite(sckPin_, LOW);

  status_ = LoadCellStatus::kInitializing;
  lastReadyMs_ = nowMs;
  nextWatchdogCheckMs_ = nowMs + kReadyTimeoutMs;
}

bool LoadCellDriver::isReady() const {
  return digitalRead(doutPin_) == LOW;
}

bool LoadCellDriver::readRawNonBlocking(int32_t& output) {
  if (!isReady()) {
    return false;
  }

  uint32_t raw = 0;
  noInterrupts();
  for (uint8_t i = 0; i < 24; ++i) {
    digitalWrite(sckPin_, HIGH);
    delayMicroseconds(1);
    raw = (raw << 1) | (digitalRead(doutPin_) == HIGH ? 1 : 0);
    digitalWrite(sckPin_, LOW);
    delayMicroseconds(1);
  }

  // 25th clock pulse configures next conversion for Channel A, Gain 128
  digitalWrite(sckPin_, HIGH);
  delayMicroseconds(1);
  digitalWrite(sckPin_, LOW);
  delayMicroseconds(1);
  interrupts();

  // Sign-extend 24-bit 2's complement to 32-bit signed
  if (raw & 0x00800000UL) {
    raw |= 0xFF000000UL;
  }

  output = static_cast<int32_t>(raw);
  return true;
}

void LoadCellDriver::updateTareStateMachine(int32_t raw) {
  if (tareState_ != TareState::kCollecting) {
    return;
  }

  tareAccumulator_ += raw;
  ++tareSamplesCollected_;

  if (tareSamplesCollected_ >= tareSamplesTarget_) {
    tareOffset_ = static_cast<int32_t>(tareAccumulator_ / tareSamplesTarget_);
    tareState_ = TareState::kComplete;
  }
}

void LoadCellDriver::processSample(int32_t raw, uint32_t nowMs) {
  lastReadyMs_ = nowMs;
  nextWatchdogCheckMs_ = nowMs + kReadyTimeoutMs;
  status_ = LoadCellStatus::kHealthy;
  ++readCount_;

  if (tareState_ == TareState::kCollecting) {
    updateTareStateMachine(raw);
  }

  const int32_t netRaw = raw - tareOffset_;
  const float factor = (fabsf(calibrationFactor_) > 0.0001F) ? calibrationFactor_ : 1.0F;

  reading_.hasSample = true;
  reading_.updatedMs = nowMs;
  reading_.rawValue = raw;
  reading_.weightGrams = static_cast<float>(netRaw) / factor;
  reading_.weightKg = reading_.weightGrams / 1000.0F;
}

void LoadCellDriver::poll(uint32_t nowMs) {
  int32_t raw = 0;
  if (readRawNonBlocking(raw)) {
    processSample(raw, nowMs);
    return;
  }

  if (timeReached(nowMs, nextWatchdogCheckMs_)) {
    nextWatchdogCheckMs_ = nowMs + kReadyTimeoutMs;
    if (elapsedMs(nowMs, lastReadyMs_) > kReadyTimeoutMs) {
      status_ = LoadCellStatus::kFault;
      ++faultCount_;
      if (tareState_ == TareState::kCollecting) {
        tareState_ = TareState::kFailed;
      }
    }
  }
}

bool LoadCellDriver::startTare(uint8_t sampleCount) {
  if (sampleCount == 0 || status_ == LoadCellStatus::kFault) {
    return false;
  }
  tareSamplesTarget_ = sampleCount;
  tareSamplesCollected_ = 0;
  tareAccumulator_ = 0;
  tareState_ = TareState::kCollecting;
  return true;
}

void LoadCellDriver::setCalibrationFactor(float factor) {
  if (fabsf(factor) > 0.0001F) {
    calibrationFactor_ = factor;
  }
}

void LoadCellDriver::setTareOffset(int32_t offset) {
  tareOffset_ = offset;
}

LoadCellStatus LoadCellDriver::status(uint32_t nowMs) const {
  if (status_ == LoadCellStatus::kHealthy &&
      elapsedMs(nowMs, lastReadyMs_) > kStaleThresholdMs) {
    return LoadCellStatus::kStale;
  }
  return status_;
}

uint32_t LoadCellDriver::sampleAgeMs(uint32_t nowMs) const {
  return elapsedMs(nowMs, reading_.updatedMs);
}

const char* loadCellStatusName(LoadCellStatus status) {
  switch (status) {
    case LoadCellStatus::kOffline:
      return "OFFLINE";
    case LoadCellStatus::kInitializing:
      return "INITIALIZING";
    case LoadCellStatus::kHealthy:
      return "HEALTHY";
    case LoadCellStatus::kStale:
      return "STALE";
    case LoadCellStatus::kFault:
      return "FAULT";
    default:
      return "UNKNOWN";
  }
}

}  // namespace fogsen
