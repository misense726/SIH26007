#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <stdint.h>

#include "FirmwareConfig.h"

namespace fogsen {

enum class NodeRole : uint8_t {
  kFront,
  kMiddle,
};

enum class NodeLinkHealth : uint8_t {
  kOffline,
  kHealthy,
  kDegraded,
  kStale,
};

namespace node_health_bits {
constexpr uint8_t kScanner = 1U << 0;
constexpr uint8_t kFixedA = 1U << 1;
constexpr uint8_t kFixedB = 1U << 2;
constexpr uint8_t kServo = 1U << 3;
constexpr uint8_t kFrontExpected = kScanner | kFixedA | kServo;
constexpr uint8_t kMiddleExpected = kFixedA | kFixedB;
constexpr uint8_t kBackExpected = kScanner | kFixedA | kFixedB | kServo;
}  // namespace node_health_bits

struct NodePacket {
  uint32_t sequence;
  uint32_t nodeMs;
  uint32_t receivedMs;
  int16_t angleDeg;
  int16_t scanMm;
  uint32_t scanMs;
  int16_t fixedAMm;
  uint32_t fixedAMs;
  int16_t fixedBMm;
  uint32_t fixedBMs;
  uint8_t healthMask;
};

struct NodeLinkStats {
  uint32_t acceptedPackets;
  uint32_t droppedPackets;
  uint32_t outOfOrderPackets;
  uint32_t parseErrors;
  uint32_t schemaErrors;
  uint32_t overflowLines;
  uint32_t wrongNodePackets;
  uint32_t replyLines;
  uint32_t rebootCount;
};

class NodeLink {
 public:
  NodeLink(NodeRole role, const char* fixedAKey, const char* fixedBKey);

  void poll(Stream& serial, uint32_t nowMs);
  void ingest(char value, uint32_t nowMs);

  bool hasPacket() const { return hasPacket_; }
  bool isFresh(uint32_t nowMs) const;
  uint32_t ageMs(uint32_t nowMs) const;
  NodeLinkHealth health(uint32_t nowMs) const;

  NodeRole role() const { return role_; }
  const NodePacket& packet() const { return packet_; }
  const NodeLinkStats& stats() const { return stats_; }
  const char* lastReply() const { return lastReply_; }

  const char* nodeName() const;
  const char* fixedAKey() const { return fixedAKey_; }
  const char* fixedBKey() const { return fixedBKey_; }
  bool hasFixedB() const { return fixedBKey_ != nullptr; }
  bool hasScanner() const { return role_ == NodeRole::kFront; }
  const char* fixedAMsKey() const {
    return role_ == NodeRole::kFront ? "front_ms" : "left_ms";
  }
  const char* fixedBMsKey() const { return "right_ms"; }
  const char* fixedAAgeKey() const {
    return role_ == NodeRole::kFront ? "front_age" : "left_age";
  }
  const char* fixedBAgeKey() const { return "right_age"; }
  uint8_t expectedHealthMask() const;

 private:
  bool handleLine(uint32_t nowMs);
  bool readRange(JsonObjectConst object,
                 const char* key,
                 int16_t maximum,
                 int16_t& value) const;
  bool acceptSequence(uint32_t sequence, uint32_t nodeMs);

  NodeRole role_;
  const char* fixedAKey_;
  const char* fixedBKey_;
  NodePacket packet_;
  NodeLinkStats stats_;
  bool hasPacket_;

  char line_[config::kNodeLineCapacity];
  size_t lineLength_;
  bool discardingOverflow_;
  char lastReply_[64];
  StaticJsonDocument<384> document_;
};

const char* nodeLinkHealthName(NodeLinkHealth health);

}  // namespace fogsen
