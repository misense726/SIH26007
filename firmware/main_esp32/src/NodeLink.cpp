#include "NodeLink.h"

#include <string.h>

#include "TimeUtils.h"

namespace fogsen {

NodeLink::NodeLink(NodeRole role, const char* fixedAKey, const char* fixedBKey)
    : role_(role),
      fixedAKey_(fixedAKey),
      fixedBKey_(fixedBKey),
      packet_{0, 0, 0, 0, -1, 0, -1, 0, -1, 0, 0},
      stats_{0, 0, 0, 0, 0, 0, 0, 0, 0},
      hasPacket_(false),
      line_{0},
      lineLength_(0),
      discardingOverflow_(false),
      lastReply_{0},
      document_() {}

const char* NodeLink::nodeName() const {
  return role_ == NodeRole::kFront ? "FRONT" : "MIDDLE";
}

uint8_t NodeLink::expectedHealthMask() const {
  return role_ == NodeRole::kFront ? node_health_bits::kFrontExpected
                                   : node_health_bits::kMiddleExpected;
}

void NodeLink::poll(Stream& serial, uint32_t nowMs) {
  size_t consumed = 0;
  while (serial.available() > 0 && consumed < config::kNodeBytesPerPoll) {
    const int next = serial.read();
    if (next < 0) {
      break;
    }
    ingest(static_cast<char>(next), nowMs);
    ++consumed;
  }
}

void NodeLink::ingest(char value, uint32_t nowMs) {
  if (value == '\r') {
    return;
  }

  if (value == '\n') {
    if (discardingOverflow_) {
      discardingOverflow_ = false;
      lineLength_ = 0;
      return;
    }
    if (lineLength_ == 0) {
      return;
    }
    line_[lineLength_] = '\0';
    handleLine(nowMs);
    lineLength_ = 0;
    return;
  }

  if (discardingOverflow_) {
    return;
  }

  if (lineLength_ + 1 >= sizeof(line_)) {
    ++stats_.overflowLines;
    discardingOverflow_ = true;
    lineLength_ = 0;
    return;
  }

  line_[lineLength_++] = value;
}

bool NodeLink::readRange(JsonObjectConst object,
                         const char* key,
                         int16_t maximum,
                         int16_t& value) const {
  const JsonVariantConst field = object[key];
  if (!field.is<int>()) {
    return false;
  }
  const int parsed = field.as<int>();
  if (parsed < -1 || parsed > maximum) {
    return false;
  }
  value = static_cast<int16_t>(parsed);
  return true;
}

bool NodeLink::acceptSequence(uint32_t sequence, uint32_t nodeMs) {
  if (!hasPacket_) {
    return true;
  }

  const bool probableReboot =
      sequence < packet_.sequence && nodeMs < packet_.nodeMs &&
      nodeMs < config::kNodeResetWindowMs &&
      static_cast<uint32_t>(packet_.nodeMs - nodeMs) > 1000U;
  if (probableReboot) {
    ++stats_.rebootCount;
    return true;
  }

  const uint32_t delta = static_cast<uint32_t>(sequence - packet_.sequence);
  if (delta == 0 || delta >= 0x80000000UL) {
    ++stats_.outOfOrderPackets;
    return false;
  }
  if (delta > 1) {
    stats_.droppedPackets += delta - 1;
  }
  return true;
}

bool NodeLink::handleLine(uint32_t nowMs) {
  document_.clear();
  const DeserializationError error =
      deserializeJson(document_, line_, lineLength_);
  if (error) {
    ++stats_.parseErrors;
    return false;
  }
  if (!document_.is<JsonObject>()) {
    ++stats_.schemaErrors;
    return false;
  }

  const JsonObjectConst object = document_.as<JsonObjectConst>();
  if (!object["node"].is<const char*>()) {
    ++stats_.schemaErrors;
    return false;
  }
  if (strcmp(object["node"].as<const char*>(), nodeName()) != 0) {
    ++stats_.wrongNodePackets;
    return false;
  }

  if (object["reply"].is<const char*>()) {
    strncpy(lastReply_, object["reply"].as<const char*>(), sizeof(lastReply_) - 1);
    lastReply_[sizeof(lastReply_) - 1] = '\0';
    ++stats_.replyLines;
    return true;
  }

  if (!object["seq"].is<uint32_t>() || !object["ms"].is<uint32_t>() ||
      (hasScanner() &&
       (!object["a"].is<int>() || !object["scan_ms"].is<uint32_t>())) ||
      !object[fixedAMsKey()].is<uint32_t>() ||
      (hasFixedB() && !object[fixedBMsKey()].is<uint32_t>()) ||
      !object["ok"].is<int>()) {
    ++stats_.schemaErrors;
    return false;
  }

  const int angle = hasScanner() ? object["a"].as<int>() : 0;
  const int healthMask = object["ok"].as<int>();
  const uint8_t unexpectedHealthBits =
      static_cast<uint8_t>(healthMask) &
      static_cast<uint8_t>(~expectedHealthMask());
  if (angle < -90 || angle > 90 || healthMask < 0 || healthMask > 255 ||
      unexpectedHealthBits != 0U) {
    ++stats_.schemaErrors;
    return false;
  }

  int16_t scanMm = -1;
  int16_t fixedAMm = -1;
  int16_t fixedBMm = -1;
  if ((hasScanner() &&
       !readRange(object, "scan", config::kScannerMaxMm, scanMm)) ||
      !readRange(object, fixedAKey_, config::kFixedMaxMm, fixedAMm) ||
      (hasFixedB() &&
       !readRange(object, fixedBKey_, config::kFixedMaxMm, fixedBMm))) {
    ++stats_.schemaErrors;
    return false;
  }

  const uint32_t sequence = object["seq"].as<uint32_t>();
  const uint32_t nodeMs = object["ms"].as<uint32_t>();
  if (!acceptSequence(sequence, nodeMs)) {
    return false;
  }

  packet_.sequence = sequence;
  packet_.nodeMs = nodeMs;
  packet_.receivedMs = nowMs;
  packet_.angleDeg = static_cast<int16_t>(angle);
  packet_.scanMm = scanMm;
  packet_.scanMs = hasScanner() ? object["scan_ms"].as<uint32_t>() : 0U;
  packet_.fixedAMm = fixedAMm;
  packet_.fixedAMs = object[fixedAMsKey()].as<uint32_t>();
  packet_.fixedBMm = fixedBMm;
  packet_.fixedBMs = hasFixedB() ? object[fixedBMsKey()].as<uint32_t>() : 0U;
  packet_.healthMask = static_cast<uint8_t>(healthMask);
  hasPacket_ = true;
  ++stats_.acceptedPackets;
  return true;
}

uint32_t NodeLink::ageMs(uint32_t nowMs) const {
  return hasPacket_ ? elapsedMs(nowMs, packet_.receivedMs) : UINT32_MAX;
}

bool NodeLink::isFresh(uint32_t nowMs) const {
  return hasPacket_ && ageMs(nowMs) <= config::kNodeStaleMs;
}

NodeLinkHealth NodeLink::health(uint32_t nowMs) const {
  if (!hasPacket_) {
    return NodeLinkHealth::kOffline;
  }
  if (!isFresh(nowMs)) {
    return NodeLinkHealth::kStale;
  }
  return (packet_.healthMask & expectedHealthMask()) == expectedHealthMask()
             ? NodeLinkHealth::kHealthy
             : NodeLinkHealth::kDegraded;
}

const char* nodeLinkHealthName(NodeLinkHealth health) {
  switch (health) {
    case NodeLinkHealth::kOffline:
      return "OFFLINE";
    case NodeLinkHealth::kHealthy:
      return "HEALTHY";
    case NodeLinkHealth::kDegraded:
      return "DEGRADED";
    case NodeLinkHealth::kStale:
      return "STALE";
  }
  return "OFFLINE";
}

}  // namespace fogsen
