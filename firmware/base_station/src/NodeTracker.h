#pragma once

#include <stddef.h>
#include <stdint.h>
#include "LoraPacket.h"

namespace fogsen {
namespace base_station {

struct TrackedNodeState {
  bool active;
  uint8_t nodeId;
  char vehicleId[16];
  LoraTelemetryPacket latestPacket;
  uint32_t lastReceivedMs;
  int16_t lastRssi;
  float lastSnr;
  uint32_t rxCount;
  uint32_t dropCount;
  uint32_t crcErrorCount;
  uint16_t lastSequence;
  float packetRateHz;
  uint32_t rateWindowStartMs;
  uint16_t packetsInWindow;
};

class NodeTracker {
 public:
  NodeTracker();

  void begin(uint32_t nowMs);
  bool ingestPacket(const LoraTelemetryPacket& packet, int16_t rssi, float snr, uint32_t nowMs);
  void recordCrcError(uint8_t nodeId);
  const TrackedNodeState* getNode(uint8_t nodeId) const;
  bool isFresh(uint8_t nodeId, uint32_t nowMs) const;
  void updateRates(uint32_t nowMs);

 private:
  TrackedNodeState nodes_[2];  // Index 0: Node 1, Index 1: Node 2
};

}  // namespace base_station
}  // namespace fogsen
