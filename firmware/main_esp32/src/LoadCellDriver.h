#pragma once

#include <Arduino.h>
#include <stdint.h>

namespace fogsen {

enum class LoadCellStatus : uint8_t {
  kOffline = 0,
  kInitializing = 1,
  kHealthy = 2,
  kStale = 3,
  kFault = 4
};

enum class TareState : uint8_t {
  kIdle = 0,
  kCollecting = 1,
  kComplete = 2,
  kFailed = 3
};

struct LoadCellReading {
  bool hasSample;
  uint32_t updatedMs;
  int32_t rawValue;
  float weightGrams;
  float weightKg;
};

class LoadCellDriver {
 public:
  LoadCellDriver(uint8_t doutPin, uint8_t sckPin);

  void begin(uint32_t nowMs);
  void poll(uint32_t nowMs);

  bool startTare(uint8_t sampleCount = 10);
  TareState tareState() const { return tareState_; }

  void setCalibrationFactor(float factor);
  float calibrationFactor() const { return calibrationFactor_; }

  int32_t tareOffset() const { return tareOffset_; }
  void setTareOffset(int32_t offset);

  LoadCellStatus status(uint32_t nowMs) const;
  uint32_t sampleAgeMs(uint32_t nowMs) const;
  const LoadCellReading& reading() const { return reading_; }
  uint32_t readCount() const { return readCount_; }
  uint32_t faultCount() const { return faultCount_; }

 private:
  bool isReady() const;
  bool readRawNonBlocking(int32_t& output);
  void processSample(int32_t raw, uint32_t nowMs);
  void updateTareStateMachine(int32_t raw);

  uint8_t doutPin_;
  uint8_t sckPin_;
  float calibrationFactor_;
  int32_t tareOffset_;

  LoadCellStatus status_;
  TareState tareState_;
  uint8_t tareSamplesTarget_;
  uint8_t tareSamplesCollected_;
  int64_t tareAccumulator_;

  LoadCellReading reading_;
  uint32_t readCount_;
  uint32_t faultCount_;
  uint32_t lastReadyMs_;
  uint32_t nextWatchdogCheckMs_;

  static constexpr uint32_t kReadyTimeoutMs = 2000;
  static constexpr uint32_t kStaleThresholdMs = 1500;
  static constexpr float kDefaultCalibrationFactor = 420.0F;
};

const char* loadCellStatusName(LoadCellStatus status);

}  // namespace fogsen
