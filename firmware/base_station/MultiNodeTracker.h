#pragma once

#include <ArduinoJson.h>
#include <stddef.h>
#include <stdint.h>
#include "BaseStationConfig.h"

namespace fogsen {
namespace basestation {

// Compact binary LoRa payload layout (38 bytes)
struct __attribute__((packed)) LoRaBinaryPayload {
  uint8_t  magic;        // 0x46 is the legacy protocol marker.
  uint8_t  nodeId;       // 1 (FRONT) or 2 (REAR)
  uint32_t seq;          // Monotonic packet sequence from node
  uint32_t nodeMs;       // Node internal millis() timestamp
  int32_t  latE7;        // Latitude * 10^7
  int32_t  lngE7;        // Longitude * 10^7
  int16_t  altDm;        // Altitude in decimetres (metres * 10)
  uint16_t speedCps;     // Speed in cm/s (m/s * 100)
  uint8_t  sats;         // Satellites count
  uint8_t  flags;        // Bit 0: gps_valid, Bit 1: load_calibrated, Bit 2: load_overload
  int32_t  weightGrams;  // Payload weight in grams (kg * 1000)
  int32_t  rawLoad;      // Raw load cell ADC reading
  int16_t  scanMm;       // Scanner range in mm (-1 if invalid)
  int16_t  aux1Mm;       // Front range (Node 1) or Left range (Node 2)
  int16_t  aux2Mm;       // Right range (Node 2)
  int8_t   angleDeg;     // Scanner servo angle (-90 to +90)
  uint8_t  healthMask;   // Node health mask
};

constexpr uint8_t kBinaryMagicByte = 0x46; // 'F'

struct NodeState {
  uint8_t  nodeId;           // 1 or 2
  char     role[8];          // "FRONT" or "REAR"
  char     state[12];        // "OFFLINE", "HEALTHY", "STALE", "DEGRADED"
  bool     hasSample;
  uint32_t lastRxMs;         // Base Station millis() at last packet
  uint32_t lastSeq;          // Last received sequence number
  uint32_t packetCount;      // Total valid packets received
  uint32_t dropCount;        // Estimated dropped packets from sequence gaps
  uint32_t outOfOrderCount;  // Out-of-order packets
  uint32_t rebootCount;      // Detected transmitter reboots
  int16_t  lastRssi;         // RSSI in dBm
  float    lastSnr;          // SNR in dB
  uint32_t nodeMs;           // Timestamp inside transmitter

  // Optical Range Readings (mm, -1 = unknown/invalid)
  int16_t  scanMm;
  int16_t  aux1Mm;           // front (Node 1) or left (Node 2)
  int16_t  aux2Mm;           // right (Node 2)
  int8_t   angleDeg;
  uint8_t  healthMask;

  // GPS Telemetry
  bool     hasGps;
  bool     gpsValid;
  double   gpsLat;
  double   gpsLng;
  float    gpsAlt;
  float    gpsSpeed;
  float    gpsHeading;
  uint8_t  gpsSats;
  float    gpsHdop;

  // LoadCell Telemetry
  bool     hasLoadCell;
  float    weightKg;
  int32_t  rawLoad;
  bool     overload;
  bool     calibrated;

  // IMU Telemetry (optional)
  bool     hasImu;
  float    ax, ay, az;
  float    gx, gy, gz;
  float    heading;

  // Environment Telemetry (optional)
  bool     hasEnv;
  float    tempC;
  float    pressureHpa;
  float    relAltM;
};

class MultiNodeTracker {
 public:
  MultiNodeTracker();

  void init();
  void reset();

  // Packet ingestion
  bool processJsonPacket(const char* jsonStr, size_t length, int16_t rssi, float snr, uint32_t nowMs);
  bool processBinaryPacket(const uint8_t* data, size_t length, int16_t rssi, float snr, uint32_t nowMs);

  // Periodic health and staleness evaluation
  void updateHealth(uint32_t nowMs);

  // Accessors
  const NodeState& node1() const { return nodes_[0]; }
  const NodeState& node2() const { return nodes_[1]; }
  const NodeState& node(uint8_t id) const {
    return (id == 2) ? nodes_[1] : nodes_[0];
  }

  uint32_t totalPackets() const { return totalPackets_; }
  uint32_t totalDrops() const { return nodes_[0].dropCount + nodes_[1].dropCount; }
  uint32_t parseErrors() const { return parseErrors_; }

  // Nearest forward obstacle calculation for MI Sense safety / E-Stop
  float calculateNearestForwardM(bool& hasValidRange) const;
  bool isForwardCoverageSufficient() const;

 private:
  void updateSequenceTracking(NodeState& state, uint32_t seq);
  uint8_t parseNodeId(JsonVariantConst nodeVal);

  NodeState nodes_[kMaxNodes];
  uint32_t totalPackets_;
  uint32_t parseErrors_;
};

}  // namespace basestation
}  // namespace fogsen
