#include "MultiNodeTracker.h"
#include <math.h>
#include <string.h>

namespace fogsen {
namespace basestation {

namespace {

bool isValidRange(int16_t rangeMm, int16_t maxMm) {
  return rangeMm >= 1 && rangeMm <= maxMm;
}

}  // namespace

MultiNodeTracker::MultiNodeTracker() : totalPackets_(0), parseErrors_(0) {
  init();
}

void MultiNodeTracker::init() {
  reset();
}

void MultiNodeTracker::reset() {
  totalPackets_ = 0;
  parseErrors_ = 0;

  for (uint8_t i = 0; i < kMaxNodes; ++i) {
    NodeState& n = nodes_[i];
    n.nodeId = i + 1;
    strncpy(n.role, (i == 0) ? "FRONT" : "REAR", sizeof(n.role) - 1);
    n.role[sizeof(n.role) - 1] = '\0';
    strncpy(n.state, "OFFLINE", sizeof(n.state) - 1);
    n.state[sizeof(n.state) - 1] = '\0';
    n.hasSample = false;
    n.lastRxMs = 0;
    n.lastSeq = 0;
    n.packetCount = 0;
    n.dropCount = 0;
    n.outOfOrderCount = 0;
    n.rebootCount = 0;
    n.lastRssi = 0;
    n.lastSnr = 0.0F;
    n.nodeMs = 0;

    n.scanMm = -1;
    n.aux1Mm = -1;
    n.aux2Mm = -1;
    n.angleDeg = 0;
    n.healthMask = 0;

    n.hasGps = false;
    n.gpsValid = false;
    n.gpsLat = 0.0;
    n.gpsLng = 0.0;
    n.gpsAlt = 0.0F;
    n.gpsSpeed = 0.0F;
    n.gpsHeading = 0.0F;
    n.gpsSats = 0;
    n.gpsHdop = 99.0F;

    n.hasLoadCell = false;
    n.weightKg = 0.0F;
    n.rawLoad = 0;
    n.overload = false;
    n.calibrated = false;

    n.hasImu = false;
    n.ax = 0.0F; n.ay = 0.0F; n.az = 0.0F;
    n.gx = 0.0F; n.gy = 0.0F; n.gz = 0.0F;
    n.heading = 0.0F;

    n.hasEnv = false;
    n.tempC = 0.0F;
    n.pressureHpa = 0.0F;
    n.relAltM = 0.0F;
  }
}

void MultiNodeTracker::updateSequenceTracking(NodeState& state, uint32_t seq) {
  if (state.packetCount == 0) {
    state.lastSeq = seq;
    state.dropCount = 0;
    state.outOfOrderCount = 0;
    state.packetCount = 1;
    return;
  }

  if (seq == state.lastSeq + 1) {
    // Exact consecutive packet
  } else if (seq > state.lastSeq + 1) {
    const uint32_t gap = seq - state.lastSeq - 1;
    if (gap < kSequenceResetGap) {
      state.dropCount += gap;
    } else {
      // Very large forward gap -> treat as sequence counter reset
      ++state.rebootCount;
    }
  } else {
    // seq <= state.lastSeq
    if (state.lastSeq > kSequenceResetGap && seq < 100) {
      // Rollover or node reboot restart
      ++state.rebootCount;
    } else {
      // Out of order or duplicate packet
      ++state.outOfOrderCount;
    }
  }

  state.lastSeq = seq;
  ++state.packetCount;
}

uint8_t MultiNodeTracker::parseNodeId(JsonVariantConst nodeVal) {
  if (nodeVal.is<int>()) {
    const int val = nodeVal.as<int>();
    return (val == 2) ? 2 : 1;
  }
  if (nodeVal.is<const char*>()) {
    const char* s = nodeVal.as<const char*>();
    if (s == nullptr) return 1;
    if (strcmp(s, "2") == 0 || strcasecmp(s, "REAR") == 0 ||
        strcasecmp(s, "MIDDLE") == 0 || strcasecmp(s, "NODE_2") == 0 ||
        strcasecmp(s, "NODE2") == 0) {
      return 2;
    }
    return 1;
  }
  return 1;
}

bool MultiNodeTracker::processJsonPacket(const char* jsonStr, size_t length,
                                         int16_t rssi, float snr, uint32_t nowMs) {
  if (jsonStr == nullptr || length == 0) {
    ++parseErrors_;
    return false;
  }

  StaticJsonDocument<1536> doc;
  const DeserializationError error = deserializeJson(doc, jsonStr, length);
  if (error) {
    ++parseErrors_;
    return false;
  }

  const uint8_t id = parseNodeId(doc["node"]);
  const uint8_t index = (id == 2) ? 1 : 0;
  NodeState& node = nodes_[index];

  const uint32_t seq = doc["seq"] | (node.lastSeq + 1);
  updateSequenceTracking(node, seq);

  node.lastRxMs = nowMs;
  node.lastRssi = rssi;
  node.lastSnr = snr;
  node.hasSample = true;
  node.nodeMs = doc["ms"] | doc["node_ms"] | nowMs;

  // 1. Range Sensors (Front, Rear, Left, Right)
  if (doc.containsKey("scan")) {
    node.scanMm = doc["scan"].as<int16_t>();
  }
  if (doc.containsKey("front")) {
    node.aux1Mm = doc["front"].as<int16_t>();
  } else if (doc.containsKey("left")) {
    node.aux1Mm = doc["left"].as<int16_t>();
  }
  if (doc.containsKey("right")) {
    node.aux2Mm = doc["right"].as<int16_t>();
  }
  if (doc.containsKey("a")) {
    node.angleDeg = doc["a"].as<int8_t>();
  }
  if (doc.containsKey("ok")) {
    node.healthMask = doc["ok"].as<uint8_t>();
  } else {
    // Default sensible health mask if omitted
    node.healthMask = (node.nodeId == 1) ? 0x0B : 0x0F;
  }

  // 2. GPS Data (supports nested "gps" object or flat keys)
  JsonObjectConst gpsObj = doc["gps"].as<JsonObjectConst>();
  if (!gpsObj.isNull()) {
    node.hasGps = true;
    node.gpsValid = (gpsObj["valid"] | (gpsObj["fix"] | 1)) != 0;
    node.gpsLat = gpsObj["lat"] | 0.0;
    node.gpsLng = gpsObj["lng"] | 0.0;
    node.gpsAlt = gpsObj["alt"] | 0.0F;
    node.gpsSpeed = gpsObj["speed"] | 0.0F;
    node.gpsHeading = gpsObj["heading"] | (gpsObj["course"] | 0.0F);
    node.gpsSats = gpsObj["sats"] | 0;
    node.gpsHdop = gpsObj["hdop"] | 1.0F;
  } else if (doc.containsKey("lat") && doc.containsKey("lng")) {
    node.hasGps = true;
    node.gpsValid = doc["valid"] | 1;
    node.gpsLat = doc["lat"] | 0.0;
    node.gpsLng = doc["lng"] | 0.0;
    node.gpsAlt = doc["alt"] | 0.0F;
    node.gpsSpeed = doc["speed"] | 0.0F;
    node.gpsHeading = doc["heading"] | 0.0F;
    node.gpsSats = doc["sats"] | 0;
    node.gpsHdop = doc["hdop"] | 1.0F;
  }

  // 3. LoadCell Data (supports nested "loadcell" object or flat keys)
  JsonObjectConst loadObj = doc["loadcell"].as<JsonObjectConst>();
  if (!loadObj.isNull()) {
    node.hasLoadCell = true;
    node.weightKg = loadObj["weight"] | 0.0F;
    node.rawLoad = loadObj["raw"] | 0;
    node.overload = (loadObj["overload"] | 0) != 0;
    node.calibrated = (loadObj["calibrated"] | 1) != 0;
  } else if (doc.containsKey("weight")) {
    node.hasLoadCell = true;
    node.weightKg = doc["weight"].as<float>();
    node.rawLoad = doc["raw_weight"] | 0;
    node.overload = (doc["overload"] | 0) != 0;
    node.calibrated = (doc["calibrated"] | 1) != 0;
  }

  // 4. IMU Data (optional)
  JsonObjectConst imuObj = doc["imu"].as<JsonObjectConst>();
  if (!imuObj.isNull()) {
    node.hasImu = true;
    node.ax = imuObj["ax"] | 0.0F;
    node.ay = imuObj["ay"] | 0.0F;
    node.az = imuObj["az"] | 9.81F;
    node.gx = imuObj["gx"] | 0.0F;
    node.gy = imuObj["gy"] | 0.0F;
    node.gz = imuObj["gz"] | 0.0F;
    node.heading = imuObj["heading"] | 0.0F;
  }

  // 5. Environment Data (optional)
  JsonObjectConst envObj = doc["env"].as<JsonObjectConst>();
  if (!envObj.isNull()) {
    node.hasEnv = true;
    node.tempC = envObj["temp"] | 0.0F;
    node.pressureHpa = envObj["pressure"] | 1013.25F;
    node.relAltM = envObj["rel_alt"] | 0.0F;
  }

  strncpy(node.state, "HEALTHY", sizeof(node.state) - 1);
  node.state[sizeof(node.state) - 1] = '\0';
  ++totalPackets_;
  return true;
}

bool MultiNodeTracker::processBinaryPacket(const uint8_t* data, size_t length,
                                           int16_t rssi, float snr, uint32_t nowMs) {
  if (data == nullptr || length != sizeof(LoRaBinaryPayload)) {
    ++parseErrors_;
    return false;
  }

  const LoRaBinaryPayload* p = reinterpret_cast<const LoRaBinaryPayload*>(data);
  if (p->magic != kBinaryMagicByte) {
    ++parseErrors_;
    return false;
  }

  const uint8_t id = (p->nodeId == 2) ? 2 : 1;
  const uint8_t index = (id == 2) ? 1 : 0;
  NodeState& node = nodes_[index];

  updateSequenceTracking(node, p->seq);
  node.lastRxMs = nowMs;
  node.lastRssi = rssi;
  node.lastSnr = snr;
  node.hasSample = true;
  node.nodeMs = p->nodeMs;

  node.scanMm = p->scanMm;
  node.aux1Mm = p->aux1Mm;
  node.aux2Mm = p->aux2Mm;
  node.angleDeg = p->angleDeg;
  node.healthMask = p->healthMask;

  // GPS decode
  node.hasGps = true;
  node.gpsValid = (p->flags & 0x01) != 0;
  node.gpsLat = static_cast<double>(p->latE7) / 1e7;
  node.gpsLng = static_cast<double>(p->lngE7) / 1e7;
  node.gpsAlt = static_cast<float>(p->altDm) / 10.0F;
  node.gpsSpeed = static_cast<float>(p->speedCps) / 100.0F;
  node.gpsSats = p->sats;
  node.gpsHeading = 0.0F;
  node.gpsHdop = 1.0F;

  // LoadCell decode
  node.hasLoadCell = true;
  node.weightKg = static_cast<float>(p->weightGrams) / 1000.0F;
  node.rawLoad = p->rawLoad;
  node.calibrated = (p->flags & 0x02) != 0;
  node.overload = (p->flags & 0x04) != 0;

  strncpy(node.state, "HEALTHY", sizeof(node.state) - 1);
  node.state[sizeof(node.state) - 1] = '\0';
  ++totalPackets_;
  return true;
}

void MultiNodeTracker::updateHealth(uint32_t nowMs) {
  for (uint8_t i = 0; i < kMaxNodes; ++i) {
    NodeState& n = nodes_[i];
    if (!n.hasSample) {
      strncpy(n.state, "OFFLINE", sizeof(n.state) - 1);
    } else if (nowMs - n.lastRxMs > kNodeStaleTimeoutMs) {
      strncpy(n.state, "STALE", sizeof(n.state) - 1);
    } else {
      strncpy(n.state, "HEALTHY", sizeof(n.state) - 1);
    }
    n.state[sizeof(n.state) - 1] = '\0';
  }
}

float MultiNodeTracker::calculateNearestForwardM(bool& hasValidRange) const {
  hasValidRange = false;
  float nearestM = 999.0F;

  // Node 1 forward ranges
  const NodeState& n1 = nodes_[0];
  if (n1.hasSample && (strcmp(n1.state, "HEALTHY") == 0 || strcmp(n1.state, "DEGRADED") == 0)) {
    // Fixed front range
    if (isValidRange(n1.aux1Mm, kFixedMaxMm)) {
      const float m = static_cast<float>(n1.aux1Mm) / 1000.0F;
      if (m < nearestM) nearestM = m;
      hasValidRange = true;
    }
    // Scanner in forward sector (-50 to +50 degrees)
    if (abs(n1.angleDeg) <= 50 && isValidRange(n1.scanMm, kScannerMaxMm)) {
      const float m = static_cast<float>(n1.scanMm) / 1000.0F;
      if (m < nearestM) nearestM = m;
      hasValidRange = true;
    }
  }

  return hasValidRange ? nearestM : -1.0F;
}

bool MultiNodeTracker::isForwardCoverageSufficient() const {
  const NodeState& n1 = nodes_[0];
  if (!n1.hasSample || strcmp(n1.state, "HEALTHY") != 0) {
    return false;
  }
  // Check that at least one forward sensor is healthy and valid
  const bool fixedValid = isValidRange(n1.aux1Mm, kFixedMaxMm);
  const bool scanValid = isValidRange(n1.scanMm, kScannerMaxMm) && (abs(n1.angleDeg) <= 50);
  return fixedValid || scanValid;
}

}  // namespace basestation
}  // namespace fogsen
