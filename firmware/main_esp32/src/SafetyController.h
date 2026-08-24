#pragma once

#include <stdint.h>

namespace fogsen {

enum class TravelDirection : int8_t {
  kReverse = -1,
  kUnknown = 0,
  kForward = 1,
};

enum class SafetyState : uint8_t {
  kSafe,
  kWarning,
  kCritical,
  kEmergencyStop,
  kSensorFault,
};

enum class SafetyReason : uint8_t {
  kClear,
  kWarningDistance,
  kCriticalDistance,
  kEmergencyPersistence,
  kObstacleStop,
  kStationaryObstacle,
  kRangeCoverageFault,
  kSensorFaultStop,
  kDirectionUnknown,
  kManualTest,
  kLatched,
};

struct SafetyParameters {
  float warningTimeS;
  float criticalTimeS;
  float emergencyTimeS;
  float stationaryWarningM;
  float stationaryCriticalM;
  float stationaryEmergencyM;
  float reactionTimeS;
  float brakingDecelerationMps2;
  float safetyMarginM;
  uint32_t emergencyPersistenceMs;
  uint32_t sensorFaultCutPersistenceMs;
  float movingSpeedFloorMps;
  float resetMaxSpeedMps;
  bool latchMotorCut;
};

struct SafetyThresholds {
  float warningM;
  float criticalM;
  float emergencyM;
};

struct SafetyInput {
  uint32_t nowMs;
  float speedMps;
  TravelDirection direction;
  bool coverageSufficient;
  bool hasValidRange;
  float nearestRangeM;
};

struct SafetyOutput {
  SafetyState state;
  SafetyReason reason;
  SafetyThresholds thresholds;
  bool motorCut;
  bool latched;
  uint32_t latchedAtMs;
  float nearestRangeM;
};

class SafetyController {
 public:
  explicit SafetyController(const SafetyParameters& parameters);

  SafetyOutput evaluate(const SafetyInput& input);
  SafetyThresholds thresholdsFor(float speedMps) const;

  void triggerManualTest(uint32_t nowMs);
  bool reset(const SafetyInput& input);
  bool canReset(const SafetyInput& input) const;

  bool motorCut() const { return motorCut_; }
  bool latched() const { return latched_; }
  uint32_t latchedAtMs() const { return latchedAtMs_; }

 private:
  SafetyOutput output(const SafetyInput& input,
                      SafetyState state,
                      SafetyReason reason) const;
  void triggerCut(uint32_t nowMs, SafetyReason reason, bool forceLatch);

  SafetyParameters parameters_;
  bool motorCut_;
  bool latched_;
  uint32_t latchedAtMs_;
  SafetyReason cutReason_;

  bool emergencyCandidateActive_;
  uint32_t emergencyCandidateSinceMs_;
  bool sensorFaultCandidateActive_;
  uint32_t sensorFaultCandidateSinceMs_;
};

const char* safetyStateName(SafetyState state);
const char* safetyReasonName(SafetyReason reason);
const char* travelDirectionName(TravelDirection direction);

}  // namespace fogsen
