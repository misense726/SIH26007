#include "SafetyController.h"

#include <math.h>

#include "TimeUtils.h"

namespace fogsen {
namespace {

float nonNegative(float value) {
  return value > 0.0F ? value : 0.0F;
}

float maximum(float a, float b) {
  return a > b ? a : b;
}

float maximum(float a, float b, float c) {
  return maximum(maximum(a, b), c);
}

}  // namespace

SafetyController::SafetyController(const SafetyParameters& parameters)
    : parameters_(parameters),
      motorCut_(false),
      latched_(false),
      latchedAtMs_(0),
      cutReason_(SafetyReason::kClear),
      emergencyCandidateActive_(false),
      emergencyCandidateSinceMs_(0),
      sensorFaultCandidateActive_(false),
      sensorFaultCandidateSinceMs_(0) {}

SafetyThresholds SafetyController::thresholdsFor(float speedMps) const {
  const float speed = nonNegative(speedMps);
  const float deceleration = maximum(parameters_.brakingDecelerationMps2, 0.01F);
  const float brakingDistance = speed * speed / (2.0F * deceleration);
  const float reactionDistance = speed * parameters_.reactionTimeS;
  const float physicsWarning =
      reactionDistance + brakingDistance + parameters_.safetyMarginM;

  SafetyThresholds thresholds;
  thresholds.warningM = maximum(parameters_.stationaryWarningM,
                                speed * parameters_.warningTimeS,
                                physicsWarning);
  thresholds.criticalM = maximum(parameters_.stationaryCriticalM,
                                 speed * parameters_.criticalTimeS,
                                 brakingDistance + parameters_.safetyMarginM);
  thresholds.emergencyM = maximum(parameters_.stationaryEmergencyM,
                                  speed * parameters_.emergencyTimeS);
  return thresholds;
}

void SafetyController::triggerCut(uint32_t nowMs,
                                  SafetyReason reason,
                                  bool forceLatch) {
  if (!motorCut_) {
    latchedAtMs_ = nowMs;
  }
  motorCut_ = true;
  latched_ = forceLatch || parameters_.latchMotorCut;
  cutReason_ = reason;
}

void SafetyController::triggerManualTest(uint32_t nowMs) {
  triggerCut(nowMs, SafetyReason::kManualTest, true);
}

bool SafetyController::canReset(const SafetyInput& input) const {
  if (nonNegative(input.speedMps) > parameters_.resetMaxSpeedMps) {
    return false;
  }
  if (!input.coverageSufficient || !input.hasValidRange) {
    return false;
  }
  return input.nearestRangeM > thresholdsFor(input.speedMps).warningM;
}

bool SafetyController::reset(const SafetyInput& input) {
  if (!canReset(input)) {
    return false;
  }
  motorCut_ = false;
  latched_ = false;
  latchedAtMs_ = 0;
  cutReason_ = SafetyReason::kClear;
  emergencyCandidateActive_ = false;
  sensorFaultCandidateActive_ = false;
  return true;
}

SafetyOutput SafetyController::output(const SafetyInput& input,
                                      SafetyState state,
                                      SafetyReason reason) const {
  SafetyOutput result;
  result.state = state;
  result.reason = reason;
  result.thresholds = thresholdsFor(input.speedMps);
  result.motorCut = motorCut_;
  result.latched = latched_;
  result.latchedAtMs = latchedAtMs_;
  result.nearestRangeM = input.hasValidRange ? input.nearestRangeM : -1.0F;
  return result;
}

SafetyOutput SafetyController::evaluate(const SafetyInput& input) {
  if (motorCut_ && latched_) {
    return output(input, SafetyState::kEmergencyStop,
                  cutReason_ == SafetyReason::kManualTest
                      ? SafetyReason::kManualTest
                      : SafetyReason::kLatched);
  }

  const SafetyThresholds thresholds = thresholdsFor(input.speedMps);
  const bool moving = nonNegative(input.speedMps) >= parameters_.movingSpeedFloorMps;
  const bool directionKnown = input.direction != TravelDirection::kUnknown;
  const bool coverageFault = !directionKnown || !input.coverageSufficient ||
                             !input.hasValidRange;

  if (coverageFault && moving) {
    if (!sensorFaultCandidateActive_) {
      sensorFaultCandidateActive_ = true;
      sensorFaultCandidateSinceMs_ = input.nowMs;
    }
    if (intervalElapsed(input.nowMs, sensorFaultCandidateSinceMs_,
                        parameters_.sensorFaultCutPersistenceMs)) {
      triggerCut(input.nowMs, SafetyReason::kSensorFaultStop, false);
      return output(input, SafetyState::kEmergencyStop,
                    SafetyReason::kSensorFaultStop);
    }
  } else {
    sensorFaultCandidateActive_ = false;
  }

  const bool insideEmergency =
      input.hasValidRange && input.nearestRangeM <= thresholds.emergencyM;
  if (insideEmergency && moving) {
    if (!emergencyCandidateActive_) {
      emergencyCandidateActive_ = true;
      emergencyCandidateSinceMs_ = input.nowMs;
    }
    if (intervalElapsed(input.nowMs, emergencyCandidateSinceMs_,
                        parameters_.emergencyPersistenceMs)) {
      triggerCut(input.nowMs, SafetyReason::kObstacleStop, false);
      return output(input, SafetyState::kEmergencyStop,
                    SafetyReason::kObstacleStop);
    }
    return output(input, SafetyState::kCritical,
                  SafetyReason::kEmergencyPersistence);
  }
  emergencyCandidateActive_ = false;

  if (insideEmergency) {
    return output(input, SafetyState::kCritical,
                  SafetyReason::kStationaryObstacle);
  }

  if (input.hasValidRange && input.nearestRangeM <= thresholds.criticalM) {
    return output(input, SafetyState::kCritical,
                  SafetyReason::kCriticalDistance);
  }

  if (coverageFault) {
    return output(input, SafetyState::kSensorFault,
                  directionKnown ? SafetyReason::kRangeCoverageFault
                                 : SafetyReason::kDirectionUnknown);
  }

  if (input.nearestRangeM <= thresholds.warningM) {
    return output(input, SafetyState::kWarning,
                  SafetyReason::kWarningDistance);
  }

  if (motorCut_ && !latched_) {
    motorCut_ = false;
    latchedAtMs_ = 0;
    cutReason_ = SafetyReason::kClear;
  }
  return output(input, SafetyState::kSafe, SafetyReason::kClear);
}

const char* safetyStateName(SafetyState state) {
  switch (state) {
    case SafetyState::kSafe:
      return "SAFE";
    case SafetyState::kWarning:
      return "WARNING";
    case SafetyState::kCritical:
      return "CRITICAL";
    case SafetyState::kEmergencyStop:
      return "EMERGENCY_STOP";
    case SafetyState::kSensorFault:
      return "SENSOR_FAULT";
  }
  return "SENSOR_FAULT";
}

const char* safetyReasonName(SafetyReason reason) {
  switch (reason) {
    case SafetyReason::kClear:
      return "CLEAR";
    case SafetyReason::kWarningDistance:
      return "WARNING_DISTANCE";
    case SafetyReason::kCriticalDistance:
      return "CRITICAL_DISTANCE";
    case SafetyReason::kEmergencyPersistence:
      return "EMERGENCY_PERSISTENCE";
    case SafetyReason::kObstacleStop:
      return "OBSTACLE_STOP";
    case SafetyReason::kStationaryObstacle:
      return "STATIONARY_OBSTACLE";
    case SafetyReason::kRangeCoverageFault:
      return "RANGE_COVERAGE_FAULT";
    case SafetyReason::kSensorFaultStop:
      return "SENSOR_FAULT_STOP";
    case SafetyReason::kDirectionUnknown:
      return "DIRECTION_UNKNOWN";
    case SafetyReason::kManualTest:
      return "MANUAL_TEST";
    case SafetyReason::kLatched:
      return "LATCHED";
  }
  return "RANGE_COVERAGE_FAULT";
}

const char* travelDirectionName(TravelDirection direction) {
  switch (direction) {
    case TravelDirection::kForward:
      return "FORWARD";
    case TravelDirection::kReverse:
      return "REVERSE";
    case TravelDirection::kUnknown:
      return "UNKNOWN";
  }
  return "UNKNOWN";
}

}  // namespace fogsen
