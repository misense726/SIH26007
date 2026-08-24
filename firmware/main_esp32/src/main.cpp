#include <Adafruit_BMP280.h>
#include <Adafruit_MPU6050.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <Wire.h>
#include <math.h>
#include <string.h>

#include "FirmwareConfig.h"
#include "LocalSensors.h"
#include "NodeLink.h"
#include "Pins.h"
#include "SafetyConfig.h"
#include "SafetyController.h"
#include "SerialTxQueue.h"
#include "TimeUtils.h"
#include "UsbCommandParser.h"
#include "WheelOdometry.h"

namespace fogsen {
namespace {

HardwareSerial frontSerial(1);
HardwareSerial rearSerial(2);
NodeLink frontNode(NodeRole::kFront, "fl", "fr");
NodeLink rearNode(NodeRole::kRear, "left", "right");
LocalSensors localSensors(Wire);
WheelOdometry wheelOdometry(config::kWheelCircumferenceM,
                            config::kMagnetsPerWheel,
                            config::kMaxPlausibleWheelSpeedMps,
                            config::kWheelSpeedHoldMs);
SerialTxQueue laptopTx;
UsbCommandParser commandParser;

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
uint32_t telemetrySequence = 0;
uint32_t telemetryOversizeDrops = 0;

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

void collectNodeRanges(const NodeLink& node,
                       uint32_t nowMs,
                       bool requireFixedPair,
                       bool requireScanner,
                       uint8_t& count,
                       float& nearestM,
                       bool& coverageSufficient) {
  if (!node.isFresh(nowMs)) {
    coverageSufficient = false;
    return;
  }

  const NodePacket& packet = node.packet();
  const bool tcaHealthy =
      (packet.healthMask & node_health_bits::kTca) != 0;
  const bool fixedAHealthy =
      tcaHealthy && (packet.healthMask & node_health_bits::kFixedA) != 0;
  const bool fixedBHealthy =
      tcaHealthy && (packet.healthMask & node_health_bits::kFixedB) != 0;
  const bool scannerHealthy =
      tcaHealthy && (packet.healthMask & node_health_bits::kScanner) != 0 &&
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
      tcaHealthy && (!requireFixedPair || (fixedAHealthy && fixedBHealthy)) &&
      (!requireScanner || scannerHealthy) && count > 0;
}

SafetyInput buildSafetyInput(uint32_t nowMs) {
  SafetyInput input;
  input.nowMs = nowMs;
  input.speedMps = wheelOdometry.state().speedMps;
  input.direction = configuredTravelDirection();
  input.coverageSufficient = false;
  input.hasValidRange = false;
  input.nearestRangeM = -1.0F;

  uint8_t validCount = 0;
  float nearestM = 0.0F;
  bool coverage = false;
  if (input.direction == TravelDirection::kForward) {
    collectNodeRanges(frontNode, nowMs,
                      safety_config::kRequireHealthyFixedPairForForward, false,
                      validCount, nearestM, coverage);
    coverage = coverage &&
               validCount >= safety_config::kMinimumValidForwardRanges;
  } else if (input.direction == TravelDirection::kReverse) {
    collectNodeRanges(rearNode, nowMs, false, true, validCount, nearestM,
                      coverage);
  } else {
    bool frontCoverage = false;
    bool rearCoverage = false;
    collectNodeRanges(frontNode, nowMs, false, false, validCount, nearestM,
                      frontCoverage);
    collectNodeRanges(rearNode, nowMs, false, false, validCount, nearestM,
                      rearCoverage);
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
    object[node.fixedAKey()] = packet.fixedAMm;
    object[node.fixedBKey()] = packet.fixedBMm;
    object["ok"] = packet.healthMask;
  } else {
    object["seq"] = nullptr;
    object["node_ms"] = nullptr;
    object["a"] = nullptr;
    object["scan"] = -1;
    object[node.fixedAKey()] = -1;
    object[node.fixedBKey()] = -1;
    object["ok"] = 0;
  }
  const NodeLinkStats& stats = node.stats();
  object["drop"] = stats.droppedPackets;
  object["ooo"] = stats.outOfOrderPackets;
  object["bad"] = stats.parseErrors + stats.schemaErrors + stats.overflowLines;
  object["reboot"] = stats.rebootCount;
}

bool queueTelemetry(uint32_t nowMs) {
  telemetryDocument.clear();
  telemetryDocument["type"] = "telemetry";
  telemetryDocument["schema"] = config::kTelemetrySchema;
  telemetryDocument["fw"] = config::kFirmwareVersion;
  telemetryDocument["mode"] = config::kDataMode;
  telemetryDocument["seq"] = telemetrySequence++;
  telemetryDocument["ms"] = nowMs;

  addNodeTelemetry(telemetryDocument.createNestedObject("front"), frontNode,
                   nowMs);
  addNodeTelemetry(telemetryDocument.createNestedObject("rear"), rearNode,
                   nowMs);

  JsonObject imu = telemetryDocument.createNestedObject("imu");
  const ImuReading& imuReading = localSensors.imu();
  imu["state"] = localSensorStatusName(localSensors.imuStatus(nowMs));
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
  emergency["cut"] = lastSafetyOutput.motorCut ? 1 : 0;
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

  JsonObject system = telemetryDocument.createNestedObject("system");
  system["tx_drop"] = laptopTx.droppedFrames();
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
  } else if (strcmp(command, "ZERO_ALT") == 0) {
    const bool ok = localSensors.zeroAltitude();
    queueCommandReply(command, ok,
                      ok ? "RELATIVE_ALTITUDE_ZEROED" : "BMP280_NOT_READY");
  } else if (strcmp(command, "RESET_TICKS") == 0) {
    resetHallTicks(nowMs);
    queueCommandReply(command, true, "HALL_TICKS_RESET");
  } else if (strcmp(command, "ESTOP_TEST") == 0) {
    safetyController.triggerManualTest(nowMs);
    lastSafetyInput = buildSafetyInput(nowMs);
    lastSafetyOutput = safetyController.evaluate(lastSafetyInput);
    applyRelayCut(true);
    queueCommandReply(command, true, "MOTOR_CUT_LATCHED");
  } else if (strcmp(command, "ESTOP_RESET") == 0) {
    lastSafetyInput = buildSafetyInput(nowMs);
    const bool ok = safetyController.reset(lastSafetyInput);
    if (ok) {
      lastSafetyOutput = safetyController.evaluate(lastSafetyInput);
      applyRelayCut(false);
    }
    queueCommandReply(
        command, ok,
        ok ? "MOTOR_CUT_RELEASED"
           : "RESET_REQUIRES_STOPPED_VEHICLE_AND_VERIFIED_CLEAR_RANGE");
  } else if (strcmp(command, "FRONT_CENTER") == 0) {
    const bool ok = sendNodeCommand(frontSerial, "CENTER");
    queueCommandReply(command, ok, ok ? "FORWARDED" : "FRONT_UART_BUSY");
  } else if (strcmp(command, "REAR_CENTER") == 0) {
    const bool ok = sendNodeCommand(rearSerial, "CENTER");
    queueCommandReply(command, ok, ok ? "FORWARDED" : "REAR_UART_BUSY");
  } else if (strcmp(command, "FRONT_SCAN_ON") == 0 ||
             strcmp(command, "FRONT_SCAN_OFF") == 0) {
    const char* nodeCommand = strcmp(command, "FRONT_SCAN_ON") == 0
                                  ? "SCAN_ON"
                                  : "SCAN_OFF";
    const bool ok = sendNodeCommand(frontSerial, nodeCommand);
    queueCommandReply(command, ok, ok ? "FORWARDED" : "FRONT_UART_BUSY");
  } else if (strcmp(command, "REAR_SCAN_ON") == 0 ||
             strcmp(command, "REAR_SCAN_OFF") == 0) {
    const char* nodeCommand = strcmp(command, "REAR_SCAN_ON") == 0
                                  ? "SCAN_ON"
                                  : "SCAN_OFF";
    const bool ok = sendNodeCommand(rearSerial, nodeCommand);
    queueCommandReply(command, ok, ok ? "FORWARDED" : "REAR_UART_BUSY");
  } else {
    queueCommandReply(command, false, "UNKNOWN_COMMAND");
  }
}

void commandHandler(const char* command, void*) {
  handleCommand(command);
}

void initializeRelay() {
  const int safeLevel = relayLevel(false);
  digitalWrite(pins::kMotorCutRelay, safeLevel);
  pinMode(pins::kMotorCutRelay, OUTPUT);
  digitalWrite(pins::kMotorCutRelay, safeLevel);
  relayCutApplied = false;
}

void queueBootEvent() {
  StaticJsonDocument<256> event;
  event["type"] = "boot";
  event["schema"] = config::kTelemetrySchema;
  event["fw"] = config::kFirmwareVersion;
  event["mode"] = config::kDataMode;
  event["ms"] = millis();
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

  pinMode(pins::kHallLeft, INPUT_PULLUP);
  pinMode(pins::kHallRight, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(pins::kHallLeft), onLeftHallTick,
                  FALLING);
  attachInterrupt(digitalPinToInterrupt(pins::kHallRight), onRightHallTick,
                  FALLING);

  Serial.setRxBufferSize(512);
  Serial.begin(config::kUsbSerialBaud);
  frontSerial.setRxBufferSize(1024);
  rearSerial.setRxBufferSize(1024);
  frontSerial.begin(config::kNodeUartBaud, SERIAL_8N1, pins::kFrontUartRx,
                    pins::kFrontUartTx);
  rearSerial.begin(config::kNodeUartBaud, SERIAL_8N1, pins::kRearUartRx,
                   pins::kRearUartTx);

  Wire.begin(pins::kI2cSda, pins::kI2cScl, config::kI2cClockHz);
  Wire.setTimeOut(config::kI2cTimeoutMs);

  const uint32_t nowMs = millis();
  uint32_t left = 0;
  uint32_t right = 0;
  snapshotHallTicks(left, right);
  wheelOdometry.begin(nowMs, left, right);
  localSensors.begin(nowMs);

  lastWheelMs = nowMs - config::kWheelPeriodMs;
  lastSafetyMs = nowMs - config::kSafetyPeriodMs;
  lastTelemetryMs = nowMs - config::kTelemetryPeriodMs;
  lastSafetyInput = buildSafetyInput(nowMs);
  lastSafetyOutput = safetyController.evaluate(lastSafetyInput);
  queueBootEvent();
}

void loop() {
  using namespace fogsen;

  const uint32_t nowMs = millis();
  laptopTx.poll(Serial);
  frontNode.poll(frontSerial, nowMs);
  rearNode.poll(rearSerial, nowMs);
  commandParser.poll(Serial, commandHandler, nullptr);

  localSensors.poll(nowMs);

  if (intervalElapsed(nowMs, lastWheelMs, config::kWheelPeriodMs)) {
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

  if (intervalElapsed(nowMs, lastTelemetryMs, config::kTelemetryPeriodMs)) {
    lastTelemetryMs = nowMs;
    queueTelemetry(nowMs);
  }

  laptopTx.poll(Serial);
  yield();
}
