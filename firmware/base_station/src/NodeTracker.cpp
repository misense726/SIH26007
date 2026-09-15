#include "NodeTracker.h"
#include <string.h>
#include "BaseStationConfig.h"

namespace fogsen {
namespace base_station {

NodeTracker::NodeTracker() {
  memset(nodes_, 0, sizeof(nodes_));
}

void NodeTracker::begin(uint32_t nowMs) {
  for (uint8_t i = 0; i < 2; ++i) {
    nodes_[i].active = false;
    nodes_[i].nodeId = i + 1;
    if (i == 0) {
      strncpy(nodes_[i].vehicleId, "DUMPER_01", sizeof(nodes_[i].vehicleId) - 1);
    } else {
      strncpy(nodes_[i].vehicleId, "DUMPER_02", sizeof(nodes_[i].vehicleId) - 1);
    }
    nodes_[i].lastReceivedMs = 0;
    nodes_[i].lastRssi = 0;
    nodes_[i].lastSnr = 0.0F;
    nodes_[i].rxCount = 0;
    nodes_[i].dropCount = 0;
    nodes_[i].crcErrorCount = 0;
    nodes_[i].lastSequence = 0;
    nodes_[i].packetRateHz = 0.0F;
    nodes_[i].rateWindowStartMs = nowMs;
    nodes_[i].packetsInWindow = 0;
  }
}

bool NodeTracker::ingestPacket(const LoraTelemetryPacket& packet, int16_t rssi, float snr, uint32_t nowMs) {
  if (packet.nodeId < 1 || packet.nodeId > 2) {
    return false;
  }

  const uint8_t idx = packet.nodeId - 1;
  TrackedNodeState& node = nodes_[idx];

  if (node.active) {
    const uint16_t expectedSeq = static_cast<uint16_t>(node.lastSequence + 1);
    if (packet.sequence != expectedSeq && packet.sequence > node.lastSequence) {
      node.dropCount += (packet.sequence - node.lastSequence - 1);
    }
  }

  node.active = true;
  node.latestPacket = packet;
  node.lastReceivedMs = nowMs;
  node.lastRssi = rssi;
  node.lastSnr = snr;
  node.lastSequence = packet.sequence;
  ++node.rxCount;
  ++node.packetsInWindow;

  if (nowMs - node.rateWindowStartMs >= 1000) {
    const uint32_t elapsed = nowMs - node.rateWindowStartMs;
    node.packetRateHz = (static_cast<float>(node.packetsInWindow) * 1000.0F) / static_cast<float>(elapsed);
    node.packetsInWindow = 0;
    node.rateWindowStartMs = nowMs;
  }

  return true;
}

void NodeTracker::recordCrcError(uint8_t nodeId) {
  if (nodeId >= 1 && nodeId <= 2) {
    ++nodes_[nodeId - 1].crcErrorCount;
  }
}

const TrackedNodeState* NodeTracker::getNode(uint8_t nodeId) const {
  if (nodeId >= 1 && nodeId <= 2) {
    return &nodes_[nodeId - 1];
  }
  return nullptr;
}

bool NodeTracker::isFresh(uint8_t nodeId, uint32_t nowMs) const {
  const TrackedNodeState* node = getNode(nodeId);
  return node != nullptr && node->active && (nowMs - node->lastReceivedMs <= kNodeStaleMs);
}

void NodeTracker::updateRates(uint32_t nowMs) {
  for (uint8_t i = 0; i < 2; ++i) {
    if (nowMs - nodes_[i].rateWindowStartMs >= 1000) {
      const uint32_t elapsed = nowMs - nodes_[i].rateWindowStartMs;
      nodes_[i].packetRateHz = (static_cast<float>(nodes_[i].packetsInWindow) * 1000.0F) / static_cast<float>(elapsed);
      nodes_[i].packetsInWindow = 0;
      nodes_[i].rateWindowStartMs = nowMs;
    }
  }
}

}  // namespace base_station
}  // namespace fogsen
