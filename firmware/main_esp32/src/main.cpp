#include <Adafruit_BMP280.h>
#include <Adafruit_MPU6050.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <Wire.h>
#include <math.h>
#include <string.h>

#include <SoftwareSerial.h>

#include "FirmwareConfig.h"
#include "GpsDriver.h"
#include "LoadCellDriver.h"
#include "LocalSensors.h"
#include "LoraPacket.h"
#include "LoraTransmitter.h"
#include "NodeLink.h"
#include "Pins.h"
#include "RearScanner.h"
#include "SafetyConfig.h"
#include "SafetyController.h"
#include "SerialTxQueue.h"
#include "TimeUtils.h"
#include "UsbCommandParser.h"
#include "WheelOdometry.h"
#include "WifiTelemetry.h"

namespace fogsen {
namespace {

HardwareSerial frontSerial(1);
HardwareSerial middleSerial(2);
SoftwareSerial gpsSerial;
NodeLink frontNode(NodeRole::kFront, "front", nullptr);
NodeLink middleNode(NodeRole::kMiddle, "left", "right");
LocalSensors localSensors(Wire);
RearScanner rearScanner(Wire);
WheelOdometry wheelOdometry(config::kWheelCircumferenceM,
                            config::kMagnetsPerWheel,
                            config::kMaxPlausibleWheelSpeedMps,
                            config::kWheelSpeedHoldMs);
SerialTxQueue laptopTx;
WifiTelemetry wifiTelemetry;
UsbCommandParser commandParser;
GpsDriver gpsDriver;
LoadCellDriver loadCell(pins::kLoadCellDout, pins::kLoadCellSck);
LoraTransmitter loraTransmitter;

SafetyParameters makeSafetyParameters() {
  SafetyParameters parameters;
  parameters.warningTimeS = safety_config::kWarningTimeS;
  parameters.criticalTimeS = safety_config::kCriticalTimeS;
  parameters.emergencyTimeS = safety_config::kEmergencyTimeS;
  parameters.stationaryWarningM = safety_config::kStationaryWarningM;
  parameters.stationaryCriticalM = safety_config::kStationaryCriticalM;
  parameters.stationaryEmergencyM = safety_config::kStationaryEmergencyM;
  parameters.reactionTimeS = safety_config::kReactionTimeS;
  parameters.brakingDecelerationMps2 =
      safety_config::kBrakingDecelerationMps2;
  parameters.safetyMarginM = safety_config::kSafetyMarginM;
  parameters.emergencyPersistenceMs =
      safety_config::kEmergencyPersistenceMs;
  parameters.sensorFaultCutPersistenceMs =
      safety_config::kSensorFaultCutPersistenceMs;
  parameters.movingSpeedFloorMps = safety_config::kMovingSpeedFloorMps;
  parameters.resetMaxSpeedMps = safety_config::kResetMaxSpeedMps;
  parameters.latchMotorCut = safety_config::kLatchMotorCut;
  return parameters;
}

SafetyController safetyController(makeSafetyParameters());
SafetyInput lastSafetyInput{0, 0.0F, TravelDirection::kUnknown, false, false,
                            -1.0F};
SafetyOutput lastSafetyOutput{};

volatile uint32_t leftHallTicks = 0;
volatile uint32_t rightHallTicks = 0;
portMUX_TYPE hallCounterMux = portMUX_INITIALIZER_UNLOCKED;

bool relayCutApplied = false;
uint32_t lastWheelMs = 0;
uint32_t lastSafetyMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastLoraTxMs = 0;
uint32_t telemetrySequence = 0;
uint32_t telemetryOversizeDrops = 0;

struct FrontScannerEvidence {
  bool valid;
  int16_t rangeMm;
  uint32_t sampleMainMs;
  bool hasProcessedPacket;
  uint32_t lastProcessedSequence;
  uint32_t observedRebootCount;
};

FrontScannerEvidence frontScannerEvidence{false, -1, 0, false, 0, 0};

StaticJsonDocument<config::kTelemetryJsonCapacity> telemetryDocument;
char telemetryLine[config::kTelemetryLineCapacity];

void IRAM_ATTR onLeftHallTick() {
  portENTER_CRITICAL_ISR(&hallCounterMux);
  leftHallTicks = leftHallTicks + 1U;
  portEXIT_CRITICAL_ISR(&hallCounterMux);
}

void IRAM_ATTR onRightHallTick() {
  portENTER_CRITICAL_ISR(&hallCounterMux);
  rightHallTicks = rightHallTicks + 1U;
  portEXIT_CRITICAL_ISR(&hallCounterMux);
}

void snapshotHallTicks(uint32_t& left, uint32_t& right) {
  portENTER_CRITICAL(&hallCounterMux);
  left = leftHallTicks;
  right = rightHallTicks;
  portEXIT_CRITICAL(&hallCounterMux);
}

void resetHallTicks(uint32_t nowMs) {
  portENTER_CRITICAL(&hallCounterMux);
  leftHallTicks = 0;
  rightHallTicks = 0;
  portEXIT_CRITICAL(&hallCounterMux);
  wheelOdometry.reset(nowMs, 0, 0);
}

int relayLevel(bool cut) {
  const bool high = safety_config::kRelayActiveHigh ? cut : !cut;
  return high ? HIGH : LOW;
}

void applyRelayCut(bool cut) {
  if (!config::kMotorCutRelayEnabled) {
    relayCutApplied = false;
    return;
  }
  if (cut == relayCutApplied) {
    return;
  }
  digitalWrite(pins::kMotorCutRelay, relayLevel(cut));
  relayCutApplied = cut;
}

TravelDirection configuredTravelDirection() {
  if (safety_config::kConfiguredTravelDirection > 0) {
    return TravelDirection::kForward;
  }
  if (safety_config::kConfiguredTravelDirection < 0) {
    return TravelDirection::kReverse;
  }
  return TravelDirection::kUnknown;
}

bool validRange(int16_t rangeMm, int16_t maximumMm) {
  return rangeMm >= 1 && rangeMm <= maximumMm;
}

void includeRange(int16_t rangeMm,
                  int16_t maximumMm,
                  uint8_t& count,
                  float& nearestM) {
  if (!validRange(rangeMm, maximumMm)) {
    return;
  }
  const float rangeM = static_cast<float>(rangeMm) / 1000.0F;
  if (count == 0 || rangeM < nearestM) {
    nearestM = rangeM;
  }
  ++count;
}

uint32_t nodeSampleAgeMs(const NodeLink& node,
                         uint32_t nowMs,
                         uint32_t sampleNodeMs) {
  const uint32_t linkAgeMs = node.ageMs(nowMs);
  const uint32_t localAgeMs = elapsedMs(node.packet().nodeMs, sampleNodeMs);
  if (UINT32_MAX - linkAgeMs < localAgeMs) {
    return UINT32_MAX;
  }
  return linkAgeMs + localAgeMs;
}

void clearFrontScannerEvidence() {
  frontScannerEvidence.valid = false;
  frontScannerEvidence.rangeMm = -1;
  frontScannerEvidence.sampleMainMs = 0;
}

bool cachedFrontScannerRange(uint32_t nowMs, int16_t& rangeMm) {
  if (!frontNode.isFresh(nowMs)) {
    clearFrontScannerEvidence();
    return false;
  }

  const NodePacket& packet = frontNode.packet();
  const NodeLinkStats& stats = frontNode.stats();
  if (stats.rebootCount != frontScannerEvidence.observedRebootCount) {
    clearFrontScannerEvidence();
    frontScannerEvidence.observedRebootCount = stats.rebootCount;
    frontScannerEvidence.hasProcessedPacket = false;
  }

  const bool scannerHealthy =
      (packet.healthMask & node_health_bits::kScanner) != 0 &&
      (packet.healthMask & node_health_bits::kServo) != 0;
  if (!scannerHealthy) {
    clearFrontScannerEvidence();
    frontScannerEvidence.hasProcessedPacket = true;
    frontScannerEvidence.lastProcessedSequence = packet.sequence;
    return false;
  }

  const bool newPacket =
      !frontScannerEvidence.hasProcessedPacket ||
      packet.sequence != frontScannerEvidence.lastProcessedSequence;
  if (newPacket) {
    frontScannerEvidence.hasProcessedPacket = true;
    frontScannerEvidence.lastProcessedSequence = packet.sequence;

    if (abs(packet.angleDeg) <= config::kScannerSafetyHalfAngleDeg) {
      const uint32_t sampleAgeMs =
          nodeSampleAgeMs(frontNode, nowMs, packet.scanMs);
      if (validRange(packet.scanMm, config::kScannerMaxMm) &&
          sampleAgeMs <= safety_config::kForwardScannerEvidenceStaleMs) {
        frontScannerEvidence.valid = true;
        frontScannerEvidence.rangeMm = packet.scanMm;
        frontScannerEvidence.sampleMainMs = nowMs - sampleAgeMs;
      } else {
        clearFrontScannerEvidence();
      }
    }
  }

  if (!frontScannerEvidence.valid ||
      elapsedMs(nowMs, frontScannerEvidence.sampleMainMs) >
          safety_config::kForwardScannerEvidenceStaleMs) {
    clearFrontScannerEvidence();
    return false;
  }

  rangeMm = frontScannerEvidence.rangeMm;
  return true;
}

void collectForwardRanges(uint32_t nowMs,
                          uint8_t& count,
                          float& nearestM,
                          bool& coverageSufficient) {
  coverageSufficient = false;

  int16_t scannerMm = -1;
  const bool scannerValid = cachedFrontScannerRange(nowMs, scannerMm);
  if (!frontNode.isFresh(nowMs)) {
    return;
  }

  const NodePacket& packet = frontNode.packet();
  const bool fixedHealthy =
      (packet.healthMask & node_health_bits::kFixedA) != 0;
  const uint32_t fixedAgeMs =
      nodeSampleAgeMs(frontNode, nowMs, packet.fixedAMs);
  const bool fixedValid =
      fixedHealthy && validRange(packet.fixedAMm, config::kFixedMaxMm) &&
      fixedAgeMs <= config::kNodeStaleMs;

  if (scannerValid) {
    includeRange(scannerMm, config::kScannerMaxMm, count, nearestM);
  }
  if (fixedValid) {
    includeRange(packet.fixedAMm, config::kFixedMaxMm, count, nearestM);
  }

  coverageSufficient =
      scannerValid && fixedValid &&
      count >= safety_config::kMinimumValidForwardRanges;
}

void collectNodeRanges(const NodeLink& node,
                       uint32_t nowMs,
                       bool requireFixedA,
                       bool requireFixedB,
                       bool requireScanner,
                       uint8_t& count,
                       float& nearestM,
                       bool& coverageSufficient) {
  if (!node.isFresh(nowMs)) {
    coverageSufficient = false;
    return;
  }

  const NodePacket& packet = node.packet();
  const bool fixedAHealthy =
      (packet.healthMask & node_health_bits::kFixedA) != 0;
  const bool fixedBHealthy =
      node.hasFixedB() &&
      (packet.healthMask & node_health_bits::kFixedB) != 0;
  const bool scannerHealthy =
      (packet.healthMask & node_health_bits::kScanner) != 0 &&
      (packet.healthMask & node_health_bits::kServo) != 0;

  if (fixedAHealthy) {
    includeRange(packet.fixedAMm, config::kFixedMaxMm, count, nearestM);
  }
  if (fixedBHealthy) {
    includeRange(packet.fixedBMm, config::kFixedMaxMm, count, nearestM);
  }
  if (scannerHealthy &&
      abs(packet.angleDeg) <= config::kScannerSafetyHalfAngleDeg) {
    includeRange(packet.scanMm, config::kScannerMaxMm, count, nearestM);
  }

  coverageSufficient =
      (!requireFixedA || fixedAHealthy) &&
      (!requireFixedB || fixedBHealthy) &&
      (!requireScanner || scannerHealthy) && count > 0;
}

uint8_t backHealthMask(uint32_t nowMs) {
  uint8_t mask = 0;
  if (rearScanner.sensorHealthy()) {
    mask |= node_health_bits::kScanner;
  }
  if (rearScanner.servoHealthy()) {
    mask |= node_health_bits::kServo;
  }
  if (middleNode.isFresh(nowMs)) {
    mask |= middleNode.packet().healthMask &
            node_health_bits::kMiddleExpected;
  }
  return mask;
}

void collectBackRanges(uint32_t nowMs,
                       uint8_t& count,
                       float& nearestM,
                       bool& coverageSufficient) {
  coverageSufficient = false;
  const RearScannerReading& reading = rearScanner.reading();
  const bool scannerHealthy = rearScanner.sensorHealthy() &&
                              rearScanner.servoHealthy();
  const bool scannerFresh =
      reading.hasSample && rearScanner.sampleAgeMs(nowMs) <= config::kNodeStaleMs;
  const bool scannerInSector =
      reading.hasSample &&
      abs(reading.angleDeg) <= config::kScannerSafetyHalfAngleDeg;
  if (scannerHealthy && scannerFresh && scannerInSector) {
    includeRange(reading.rangeMm, config::kScannerMaxMm, count, nearestM);
  }
  coverageSufficient = scannerHealthy && scannerFresh && scannerInSector &&
                       validRange(reading.rangeMm, config::kScannerMaxMm);
}

SafetyInput buildSafetyInput(uint32_t nowMs) {
  SafetyInput input;
  input.nowMs = nowMs;
  input.speedMps =
      config::kHallSensorsEnabled ? wheelOdometry.state().speedMps : 0.0F;
  input.direction = configuredTravelDirection();
  input.coverageSufficient = false;
  input.hasValidRange = false;
  input.nearestRangeM = -1.0F;

  uint8_t validCount = 0;
  float nearestM = 0.0F;
  bool coverage = false;
  if (input.direction == TravelDirection::kForward) {
    collectForwardRanges(nowMs, validCount, nearestM, coverage);
  } else if (input.direction == TravelDirection::kReverse) {
    collectBackRanges(nowMs, validCount, nearestM, coverage);
  } else {
    bool frontCoverage = false;
    bool middleCoverage = false;
    bool backCoverage = false;
    collectNodeRanges(frontNode, nowMs, false, false, false,
                      validCount, nearestM,
                      frontCoverage);
    collectNodeRanges(middleNode, nowMs, false, false, false,
                      validCount, nearestM,
                      middleCoverage);
    collectBackRanges(nowMs, validCount, nearestM, backCoverage);
    coverage = false;
  }

  input.hasValidRange = validCount > 0;
  input.coverageSufficient = coverage;
  input.nearestRangeM = input.hasValidRange ? nearestM : -1.0F;
  return input;
}

float compactFloat(float value, float scale) {
  return roundf(value * scale) / scale;
}

void addNullableAge(JsonObject object, const char* key, bool present,
                    uint32_t age) {
  if (present) {
    object[key] = age;
  } else {
    object[key] = nullptr;
  }
}

void addNodeTelemetry(JsonObject object,
                      const NodeLink& node,
                      uint32_t nowMs) {
  object["state"] = nodeLinkHealthName(node.health(nowMs));
  addNullableAge(object, "age", node.hasPacket(), node.ageMs(nowMs));
  if (node.hasPacket()) {
    const NodePacket& packet = node.packet();
    object["seq"] = packet.sequence;
    object["node_ms"] = packet.nodeMs;
    object["a"] = packet.angleDeg;
    object["scan"] = packet.scanMm;
    object["scan_age"] = nodeSampleAgeMs(node, nowMs, packet.scanMs);
    object[node.fixedAKey()] = packet.fixedAMm;
    object[node.fixedAAgeKey()] =
        nodeSampleAgeMs(node, nowMs, packet.fixedAMs);
    if (node.hasFixedB()) {
      object[node.fixedBKey()] = packet.fixedBMm;
      object[node.fixedBAgeKey()] =
          nodeSampleAgeMs(node, nowMs, packet.fixedBMs);
    }
    object["ok"] = packet.healthMask;
  } else {
    object["seq"] = nullptr;
    object["node_ms"] = nullptr;
    object["a"] = nullptr;
    object["scan"] = -1;
    object["scan_age"] = nullptr;
    object[node.fixedAKey()] = -1;
    object[node.fixedAAgeKey()] = nullptr;
    if (node.hasFixedB()) {
      object[node.fixedBKey()] = -1;
      object[node.fixedBAgeKey()] = nullptr;
    }
    object["ok"] = 0;
  }
  const NodeLinkStats& stats = node.stats();
  object["drop"] = stats.droppedPackets;
  object["ooo"] = stats.outOfOrderPackets;
  object["bad"] = stats.parseErrors + stats.schemaErrors + stats.overflowLines;
  object["reboot"] = stats.rebootCount;
}

void addBackTelemetry(JsonObject object, uint32_t nowMs) {
  const RearScannerReading& scanner = rearScanner.reading();
  const uint8_t healthMask = backHealthMask(nowMs);
  const bool scannerFresh =
      scanner.hasSample && rearScanner.sampleAgeMs(nowMs) <= config::kNodeStaleMs;
  const bool middleFresh = middleNode.isFresh(nowMs);
  const bool anyData = scanner.hasSample || middleNode.hasPacket();
  const bool allHealthy =
      healthMask == node_health_bits::kBackExpected && scannerFresh &&
      middleFresh;
  object["state"] = !anyData ? "OFFLINE" : allHealthy ? "HEALTHY" : "DEGRADED";

  uint32_t aggregateAgeMs = 0;
  if (scanner.hasSample) {
    aggregateAgeMs = rearScanner.sampleAgeMs(nowMs);
  }
  if (middleNode.hasPacket() && middleNode.ageMs(nowMs) > aggregateAgeMs) {
    aggregateAgeMs = middleNode.ageMs(nowMs);
  }
  addNullableAge(object, "age", anyData, aggregateAgeMs);
  object["seq"] = middleNode.hasPacket() ? middleNode.packet().sequence : 0U;
  object["node_ms"] = nowMs;

  if (scanner.hasSample) {
    object["a"] = scanner.angleDeg;
    object["scan"] = scanner.rangeMm;
    object["scan_age"] = rearScanner.sampleAgeMs(nowMs);
  } else {
    object["a"] = nullptr;
    object["scan"] = -1;
    object["scan_age"] = nullptr;
  }

  if (middleNode.hasPacket()) {
    const NodePacket& packet = middleNode.packet();
    object["left"] = packet.fixedAMm;
    object["left_age"] = nodeSampleAgeMs(middleNode, nowMs, packet.fixedAMs);
    object["right"] = packet.fixedBMm;
    object["right_age"] = nodeSampleAgeMs(middleNode, nowMs, packet.fixedBMs);
  } else {
    object["left"] = -1;
    object["left_age"] = nullptr;
    object["right"] = -1;
    object["right_age"] = nullptr;
  }
  object["ok"] = healthMask;

  const NodeLinkStats& stats = middleNode.stats();
  object["drop"] = stats.droppedPackets;
  object["ooo"] = stats.outOfOrderPackets;
  object["bad"] = stats.parseErrors + stats.schemaErrors + stats.overflowLines;
  object["reboot"] = stats.rebootCount;
  object["scanner_err"] = rearScanner.failures();
}

bool queueTelemetry(uint32_t nowMs) {
  telemetryDocument.clear();
  telemetryDocument["type"] = "telemetry";
  telemetryDocument["schema"] = config::kTelemetrySchema;
  telemetryDocument["fw"] = config::kFirmwareVersion;
  telemetryDocument["mode"] = config::kDataMode;
  telemetryDocument["seq"] = telemetrySequence++;
  telemetryDocument["ms"] = nowMs;
  telemetryDocument["vehicle_id"] = "DUMPER_01";

  addNodeTelemetry(telemetryDocument.createNestedObject("front"), frontNode,
                   nowMs);
  addBackTelemetry(telemetryDocument.createNestedObject("rear"), nowMs);

  JsonObject imu = telemetryDocument.createNestedObject("imu");
  const ImuReading& imuReading = localSensors.imu();
  imu["state"] = localSensorStatusName(localSensors.imuStatus(nowMs));
  imu["calibrated"] = imuReading.calibrated;
  imu["zeroing"] = imuReading.zeroing;
  if (imuReading.calibrated) {
    imu["zero_ms"] = imuReading.zeroedMs;
  } else {
    imu["zero_ms"] = nullptr;
  }
  addNullableAge(imu, "age", imuReading.hasSample,
                 localSensors.imuAgeMs(nowMs));
  if (imuReading.hasSample) {
    imu["ax"] = compactFloat(imuReading.accelerationXMps2, 1000.0F);
    imu["ay"] = compactFloat(imuReading.accelerationYMps2, 1000.0F);
    imu["az"] = compactFloat(imuReading.accelerationZMps2, 1000.0F);
    imu["gx"] = compactFloat(imuReading.gyroXDps, 100.0F);
    imu["gy"] = compactFloat(imuReading.gyroYDps, 100.0F);
    imu["gz"] = compactFloat(imuReading.gyroZDps, 100.0F);
  } else {
    imu["ax"] = nullptr;
    imu["ay"] = nullptr;
    imu["az"] = nullptr;
    imu["gx"] = nullptr;
    imu["gy"] = nullptr;
    imu["gz"] = nullptr;
  }
  imu["err"] = localSensors.imuReadFailures();

  JsonObject environment = telemetryDocument.createNestedObject("env");
  const EnvironmentReading& environmentReading = localSensors.environment();
  environment["state"] =
      localSensorStatusName(localSensors.environmentStatus(nowMs));
  addNullableAge(environment, "age", environmentReading.hasSample,
                 localSensors.environmentAgeMs(nowMs));
  if (environmentReading.hasSample) {
    environment["temp"] =
        compactFloat(environmentReading.temperatureC, 100.0F);
    environment["pressure"] =
        compactFloat(environmentReading.pressureHpa, 100.0F);
  } else {
    environment["temp"] = nullptr;
    environment["pressure"] = nullptr;
  }
  if (environmentReading.relativeAltitudeReady) {
    environment["rel_alt"] =
        compactFloat(environmentReading.relativeAltitudeM, 100.0F);
  } else {
    environment["rel_alt"] = nullptr;
  }
  environment["baseline"] = environmentReading.relativeAltitudeReady ? 1 : 0;
  environment["err"] = localSensors.environmentReadFailures();

  const WheelState& wheels = wheelOdometry.state();
  JsonObject wheel = telemetryDocument.createNestedObject("wheel");
  wheel["enabled"] = config::kHallSensorsEnabled ? 1 : 0;
  wheel["l"] = wheels.leftTicks;
  wheel["r"] = wheels.rightTicks;
  wheel["ls"] = compactFloat(wheels.leftSpeedMps, 1000.0F);
  wheel["rs"] = compactFloat(wheels.rightSpeedMps, 1000.0F);
  wheel["speed"] = compactFloat(wheels.speedMps, 1000.0F);

  JsonObject emergency = telemetryDocument.createNestedObject("estop");
  emergency["state"] = safetyStateName(lastSafetyOutput.state);
  emergency["reason"] = safetyReasonName(lastSafetyOutput.reason);
  emergency["direction"] = travelDirectionName(lastSafetyInput.direction);
  emergency["coverage"] = lastSafetyInput.coverageSufficient ? 1 : 0;
  emergency["output_enabled"] =
      config::kMotorCutRelayEnabled ? 1 : 0;
  emergency["cut_requested"] = lastSafetyOutput.motorCut ? 1 : 0;
  emergency["cut"] = relayCutApplied ? 1 : 0;
  emergency["latched"] = lastSafetyOutput.latched ? 1 : 0;
  if (lastSafetyInput.hasValidRange) {
    emergency["nearest"] =
        compactFloat(lastSafetyOutput.nearestRangeM, 1000.0F);
  } else {
    emergency["nearest"] = nullptr;
  }
  emergency["warn"] =
      compactFloat(lastSafetyOutput.thresholds.warningM, 1000.0F);
  emergency["critical"] =
      compactFloat(lastSafetyOutput.thresholds.criticalM, 1000.0F);
  emergency["stop"] =
      compactFloat(lastSafetyOutput.thresholds.emergencyM, 1000.0F);
  emergency["latched_ms"] =
      lastSafetyOutput.latched ? lastSafetyOutput.latchedAtMs : 0;

  JsonObject gps = telemetryDocument.createNestedObject("gps");
  const GpsReading& gpsReading = gpsDriver.reading();
  gps["state"] = gpsFixStatusName(gpsReading.fixStatus);
  gps["fix"] = gpsReading.hasFix ? 1 : 0;
  gps["sats"] = gpsReading.satellites;
  gps["hdop"] = compactFloat(gpsReading.hdop, 100.0F);
  if (gpsReading.hasFix) {
    gps["lat"] = compactFloat(static_cast<float>(gpsReading.latitudeDeg), 1000000.0F);
    gps["lon"] = compactFloat(static_cast<float>(gpsReading.longitudeDeg), 1000000.0F);
    gps["alt"] = compactFloat(gpsReading.altitudeM, 100.0F);
    gps["speed"] = compactFloat(gpsReading.speedMps, 100.0F);
    gps["course"] = compactFloat(gpsReading.courseDeg, 100.0F);
    gps["age"] = gpsDriver.sampleAgeMs(nowMs);
  } else {
    gps["lat"] = nullptr;
    gps["lon"] = nullptr;
    gps["alt"] = nullptr;
    gps["speed"] = nullptr;
    gps["course"] = nullptr;
    gps["age"] = nullptr;
  }

  JsonObject loadcellObj = telemetryDocument.createNestedObject("loadcell");
  const LoadCellReading& lcReading = loadCell.reading();
  loadcellObj["state"] = loadCellStatusName(loadCell.status(nowMs));
  loadcellObj["tare_state"] = static_cast<uint8_t>(loadCell.tareState());
  if (lcReading.hasSample && loadCell.status(nowMs) == LoadCellStatus::kHealthy) {
    loadcellObj["weight_g"] = compactFloat(lcReading.weightGrams, 10.0F);
    loadcellObj["weight_kg"] = compactFloat(lcReading.weightKg, 100.0F);
    loadcellObj["raw"] = lcReading.rawValue;
    loadcellObj["age"] = loadCell.sampleAgeMs(nowMs);
  } else {
    loadcellObj["weight_g"] = nullptr;
    loadcellObj["weight_kg"] = nullptr;
    loadcellObj["raw"] = nullptr;
    loadcellObj["age"] = nullptr;
  }

  JsonObject loraObj = telemetryDocument.createNestedObject("lora");
  loraObj["state"] = loraStatusName(loraTransmitter.status());
  loraObj["node_id"] = config::kLoraNodeId;
  loraObj["tx_count"] = loraTransmitter.txCount();
  loraObj["tx_fail"] = loraTransmitter.txFailCount();
  loraObj["last_tx_ms"] = loraTransmitter.lastTxMs();

  JsonObject system = telemetryDocument.createNestedObject("system");
  system["tx_drop"] = laptopTx.droppedFrames();
  system["wifi_sta"] = wifiTelemetry.stationConnected() ? 1 : 0;
  system["wifi_backend"] = wifiTelemetry.backendConnected() ? 1 : 0;
  system["wifi_tx"] = wifiTelemetry.sentFrames();
  system["wifi_drop"] = wifiTelemetry.droppedFrames();
  system["json_drop"] = telemetryOversizeDrops;
  system["cmd_overflow"] = commandParser.overflowLines();

  if (telemetryDocument.overflowed()) {
    ++telemetryOversizeDrops;
    return false;
  }
  const size_t required = measureJson(telemetryDocument);
  if (required + 1 >= sizeof(telemetryLine)) {
    ++telemetryOversizeDrops;
    return false;
  }
  const size_t written =
      serializeJson(telemetryDocument, telemetryLine, sizeof(telemetryLine));
  wifiTelemetry.enqueueLine(telemetryLine, written);
  return laptopTx.enqueueLine(telemetryLine, written);
}

void queueCommandReply(const char* command, bool ok, const char* reason) {
  StaticJsonDocument<256> reply;
  reply["type"] = "command_reply";
  reply["schema"] = config::kTelemetrySchema;
  reply["ms"] = millis();
  reply["cmd"] = command;
  reply["ok"] = ok ? 1 : 0;
  reply["reason"] = reason;
  char line[256];
  const size_t length = serializeJson(reply, line, sizeof(line));
  laptopTx.enqueueLine(line, length);
}

bool sendNodeCommand(HardwareSerial& serial, const char* command) {
  const size_t length = strlen(command);
  if (serial.availableForWrite() < static_cast<int>(length + 1)) {
    return false;
  }
  serial.write(reinterpret_cast<const uint8_t*>(command), length);
  serial.write('\n');
  return true;
}

void handleCommand(const char* command) {
  const uint32_t nowMs = millis();
  if (strcmp(command, "STATUS") == 0) {
    queueCommandReply(command, true, "TELEMETRY_QUEUED");
    queueTelemetry(nowMs);
  } else if (strcmp(command, "ZERO_IMU") == 0) {
    const bool ok = localSensors.zeroImu(nowMs);
    queueCommandReply(command, ok,
                      ok ? "IMU_ZEROING_STARTED" : "MPU6050_NOT_READY");
  } else if (strcmp(command, "ZERO_ALT") == 0) {
    const bool ok = localSensors.zeroAltitude();
    queueCommandReply(command, ok,
                      ok ? "RELATIVE_ALTITUDE_ZEROED" : "BMP280_NOT_READY");
  } else if (strcmp(command, "RESET_TICKS") == 0) {
    if (config::kHallSensorsEnabled) {
      resetHallTicks(nowMs);
      queueCommandReply(command, true, "HALL_TICKS_RESET");
    } else {
      queueCommandReply(command, false, "HALL_SENSORS_DISABLED");
    }
  } else if (strcmp(command, "ESTOP_TEST") == 0) {
    if (config::kMotorCutRelayEnabled) {
      safetyController.triggerManualTest(nowMs);
      lastSafetyInput = buildSafetyInput(nowMs);
      lastSafetyOutput = safetyController.evaluate(lastSafetyInput);
      applyRelayCut(true);
      queueCommandReply(command, true, "MOTOR_CUT_LATCHED");
    } else {
      queueCommandReply(command, false, "RELAY_OUTPUT_DISABLED");
    }
  } else if (strcmp(command, "ESTOP_RESET") == 0) {
    lastSafetyInput = buildSafetyInput(nowMs);
    const bool ok = safetyController.reset(lastSafetyInput);
    if (ok) {
      lastSafetyOutput = safetyController.evaluate(lastSafetyInput);
      applyRelayCut(false);
    }
    const char* reason =
        !ok ? "RESET_REQUIRES_STOPPED_VEHICLE_AND_VERIFIED_CLEAR_RANGE"
            : config::kMotorCutRelayEnabled ? "MOTOR_CUT_RELEASED"
                                            : "SAFETY_LATCH_RESET";
    queueCommandReply(command, ok, reason);
  } else if (strcmp(command, "FRONT_CENTER") == 0) {
    const bool ok = sendNodeCommand(frontSerial, "CENTER");
    queueCommandReply(command, ok, ok ? "FORWARDED" : "FRONT_UART_BUSY");
  } else if (strcmp(command, "REAR_CENTER") == 0) {
    const bool ok = rearScanner.center(nowMs);
    queueCommandReply(command, ok, ok ? "CENTERED" : "REAR_SERVO_ERROR");
  } else if (strcmp(command, "FRONT_SCAN_ON") == 0 ||
             strcmp(command, "FRONT_SCAN_OFF") == 0) {
    const char* nodeCommand = strcmp(command, "FRONT_SCAN_ON") == 0
                                  ? "SCAN_ON"
                                  : "SCAN_OFF";
    const bool ok = sendNodeCommand(frontSerial, nodeCommand);
    queueCommandReply(command, ok, ok ? "FORWARDED" : "FRONT_UART_BUSY");
  } else if (strcmp(command, "REAR_SCAN_ON") == 0 ||
             strcmp(command, "REAR_SCAN_OFF") == 0) {
    const bool enabled = strcmp(command, "REAR_SCAN_ON") == 0;
    const bool ok = rearScanner.setScanning(enabled, nowMs);
    queueCommandReply(command, ok, ok ? "APPLIED" : "REAR_SERVO_ERROR");
  } else if (strcmp(command, "MIDDLE_STATUS") == 0) {
    const bool ok = sendNodeCommand(middleSerial, "STATUS");
    queueCommandReply(command, ok, ok ? "FORWARDED" : "MIDDLE_UART_BUSY");
  } else if (strcmp(command, "TARE_LOADCELL") == 0) {
    const bool ok = loadCell.startTare(config::kLoadCellTareSamples);
    queueCommandReply(command, ok, ok ? "TARE_STARTED" : "LOADCELL_NOT_READY");
  } else if (strncmp(command, "SET_CAL ", 8) == 0) {
    const float factor = atof(command + 8);
    loadCell.setCalibrationFactor(factor);
    queueCommandReply(command, true, "CALIBRATION_UPDATED");
  } else {
    queueCommandReply(command, false, "UNKNOWN_COMMAND");
  }
}

void commandHandler(const char* command, void*) {
  handleCommand(command);
}

void initializeRelay() {
  relayCutApplied = false;
  if (!config::kMotorCutRelayEnabled) {
    pinMode(pins::kMotorCutRelay, INPUT);
    return;
  }
  const int safeLevel = relayLevel(false);
  digitalWrite(pins::kMotorCutRelay, safeLevel);
  pinMode(pins::kMotorCutRelay, OUTPUT);
  digitalWrite(pins::kMotorCutRelay, safeLevel);
}

void initializeHallSensors(uint32_t nowMs) {
  uint32_t left = 0;
  uint32_t right = 0;
  if (config::kHallSensorsEnabled) {
    pinMode(pins::kHallLeft, INPUT_PULLUP);
    pinMode(pins::kHallRight, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(pins::kHallLeft), onLeftHallTick,
                    FALLING);
    attachInterrupt(digitalPinToInterrupt(pins::kHallRight), onRightHallTick,
                    FALLING);
    snapshotHallTicks(left, right);
  } else {
    pinMode(pins::kHallLeft, INPUT);
    pinMode(pins::kHallRight, INPUT);
  }
  wheelOdometry.begin(nowMs, left, right);
}

void sendLoraTelemetry(uint32_t nowMs) {
  LoraTelemetryPacket packet{};
  packet.magic = kLoraPacketMagic;
  packet.nodeId = config::kLoraNodeId;
  packet.sequence = static_cast<uint16_t>(telemetrySequence & 0xFFFF);
  packet.timestampMs = nowMs;

  packet.rangesMm[0] = frontNode.hasPacket() ? frontNode.packet().scanMm : -1;
  packet.rangesMm[1] = frontNode.hasPacket() ? frontNode.packet().fixedAMm : -1;
  packet.rangesMm[2] = rearScanner.reading().hasSample ? rearScanner.reading().rangeMm : -1;
  packet.rangesMm[3] = middleNode.hasPacket() ? middleNode.packet().fixedAMm : -1;
  packet.rangesMm[4] = middleNode.hasPacket() ? middleNode.packet().fixedBMm : -1;

  packet.anglesDeg[0] = frontNode.hasPacket() ? static_cast<int8_t>(frontNode.packet().angleDeg) : 0;
  packet.anglesDeg[1] = rearScanner.reading().hasSample ? static_cast<int8_t>(rearScanner.reading().angleDeg) : 0;

  const ImuReading& imu = localSensors.imu();
  if (imu.hasSample) {
    packet.accelMg[0] = static_cast<int16_t>(roundf(imu.accelerationXMps2 * (1000.0F / 9.80665F)));
    packet.accelMg[1] = static_cast<int16_t>(roundf(imu.accelerationYMps2 * (1000.0F / 9.80665F)));
    packet.accelMg[2] = static_cast<int16_t>(roundf(imu.accelerationZMps2 * (1000.0F / 9.80665F)));
    packet.gyroDpsX10[0] = static_cast<int16_t>(roundf(imu.gyroXDps * 10.0F));
    packet.gyroDpsX10[1] = static_cast<int16_t>(roundf(imu.gyroYDps * 10.0F));
    packet.gyroDpsX10[2] = static_cast<int16_t>(roundf(imu.gyroZDps * 10.0F));
  }

  const EnvironmentReading& env = localSensors.environment();
  if (env.hasSample) {
    packet.tempCc = static_cast<int16_t>(roundf(env.temperatureC * 100.0F));
    packet.pressureDpa = static_cast<uint16_t>(roundf(env.pressureHpa * 10.0F));
    if (env.relativeAltitudeReady) {
      packet.relAltDm = static_cast<int16_t>(roundf(env.relativeAltitudeM * 10.0F));
    }
  }

  const GpsReading& gps = gpsDriver.reading();
  packet.gpsFix = static_cast<uint8_t>(gps.fixStatus);
  packet.satellites = static_cast<uint8_t>(gps.satellites);
  if (gps.hasFix) {
    packet.lat1e7 = static_cast<int32_t>(round(gps.latitudeDeg * 1e7));
    packet.lon1e7 = static_cast<int32_t>(round(gps.longitudeDeg * 1e7));
    packet.altM = static_cast<int16_t>(roundf(gps.altitudeM));
    packet.speedCms = static_cast<uint16_t>(roundf(gps.speedMps * 100.0F));
    packet.courseCdeg = static_cast<uint16_t>(roundf(gps.courseDeg * 100.0F));
  }

  const LoadCellReading& lc = loadCell.reading();
  packet.weightStatus = static_cast<uint8_t>(loadCell.status(nowMs));
  if (lc.hasSample && loadCell.status(nowMs) == LoadCellStatus::kHealthy) {
    packet.weightGrams = static_cast<int32_t>(roundf(lc.weightGrams));
  }

  packet.estopState = static_cast<uint8_t>(lastSafetyOutput.state);
  packet.estopCut = relayCutApplied ? 1 : 0;
  packet.nearestMm = lastSafetyInput.hasValidRange
                         ? static_cast<int16_t>(roundf(lastSafetyOutput.nearestRangeM * 1000.0F))
                         : -1;

  stampPacketCrc(packet);
  loraTransmitter.sendTelemetry(packet, nowMs);
}

void queueBootEvent() {
  StaticJsonDocument<256> event;
  event["type"] = "boot";
  event["schema"] = config::kTelemetrySchema;
  event["fw"] = config::kFirmwareVersion;
  event["mode"] = config::kDataMode;
  event["ms"] = millis();
  event["hall_enabled"] = config::kHallSensorsEnabled ? 1 : 0;
  event["relay_enabled"] = config::kMotorCutRelayEnabled ? 1 : 0;
  event["relay_cut"] = 0;
  char line[256];
  const size_t length = serializeJson(event, line, sizeof(line));
  laptopTx.enqueueLine(line, length);
}

}  // namespace
}  // namespace fogsen

void setup() {
  using namespace fogsen;

  initializeRelay();

  Serial.setRxBufferSize(512);
  Serial.begin(config::kUsbSerialBaud);
  frontSerial.setRxBufferSize(1024);
  middleSerial.setRxBufferSize(1024);
  frontSerial.begin(config::kNodeUartBaud, SERIAL_8N1, pins::kFrontUartRx,
                    pins::kFrontUartTx);
  middleSerial.begin(config::kNodeUartBaud, SERIAL_8N1, pins::kMiddleUartRx,
                     pins::kMiddleUartTx);

  Wire.begin(pins::kI2cSda, pins::kI2cScl, config::kI2cClockHz);
  Wire.setTimeOut(config::kI2cTimeoutMs);

  const uint32_t nowMs = millis();
  initializeHallSensors(nowMs);
  rearScanner.begin(nowMs);
  localSensors.begin(nowMs);
  if (config::kWifiTelemetryEnabled) {
    wifiTelemetry.begin();
  }

  gpsSerial.begin(config::kGpsBaud, SWSERIAL_8N1, pins::kGpsRx, pins::kGpsTx);
  gpsDriver.begin(nowMs);
  loadCell.begin(nowMs);
  if (config::kLoraTelemetryEnabled) {
    loraTransmitter.begin(nowMs);
  }

  lastWheelMs = nowMs - config::kWheelPeriodMs;
  lastSafetyMs = nowMs - config::kSafetyPeriodMs;
  lastTelemetryMs = nowMs - config::kTelemetryPeriodMs;
  lastLoraTxMs = nowMs - config::kLoraTxPeriodMs;
  lastSafetyInput = buildSafetyInput(nowMs);
  lastSafetyOutput = safetyController.evaluate(lastSafetyInput);
  queueBootEvent();
}

void loop() {
  using namespace fogsen;

  const uint32_t nowMs = millis();
  laptopTx.poll(Serial);
  frontNode.poll(frontSerial, nowMs);
  middleNode.poll(middleSerial, nowMs);
  commandParser.poll(Serial, commandHandler, nullptr);

  rearScanner.poll(nowMs);
  localSensors.poll(nowMs);
  gpsDriver.poll(gpsSerial, nowMs);
  loadCell.poll(nowMs);

  if (config::kHallSensorsEnabled &&
      intervalElapsed(nowMs, lastWheelMs, config::kWheelPeriodMs)) {
    lastWheelMs = nowMs;
    uint32_t left = 0;
    uint32_t right = 0;
    snapshotHallTicks(left, right);
    wheelOdometry.update(nowMs, left, right);
  }

  if (intervalElapsed(nowMs, lastSafetyMs, config::kSafetyPeriodMs)) {
    lastSafetyMs = nowMs;
    lastSafetyInput = buildSafetyInput(nowMs);
    lastSafetyOutput = safetyController.evaluate(lastSafetyInput);
    applyRelayCut(lastSafetyOutput.motorCut);
  }

  if (config::kUsbTelemetryEnabled &&
      intervalElapsed(nowMs, lastTelemetryMs, config::kTelemetryPeriodMs)) {
    lastTelemetryMs = nowMs;
    queueTelemetry(nowMs);
  }

  if (config::kLoraTelemetryEnabled &&
      intervalElapsed(nowMs, lastLoraTxMs, config::kLoraTxPeriodMs)) {
    lastLoraTxMs = nowMs;
    sendLoraTelemetry(nowMs);
  }

  laptopTx.poll(Serial);
  yield();
}
