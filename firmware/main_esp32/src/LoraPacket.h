#pragma once

#include <stddef.h>
#include <stdint.h>

namespace fogsen {

constexpr uint8_t kLoraPacketMagic = 0xAA;
constexpr size_t kLoraPacketPayloadSize = 65;

#pragma pack(push, 1)
struct LoraTelemetryPacket {
  uint8_t magic;           // 0xAA frame sync
  uint8_t nodeId;          // 1 (DUMPER_01) or 2 (DUMPER_02)
  uint16_t sequence;       // Monotonic sequence number
  uint32_t timestampMs;    // Node timestamp in milliseconds

  int16_t rangesMm[5];     // 0: front_scan, 1: front_fixed, 2: rear_scan, 3: left, 4: right
  int8_t anglesDeg[2];     // 0: front servo angle, 1: rear servo angle (-90..+90)

  int16_t accelMg[3];      // ax, ay, az in milli-g (1000 mg = 1 g)
  int16_t gyroDpsX10[3];   // gx, gy, gz in 0.1 deg/s

  int16_t tempCc;          // Temperature in 0.01 deg C
  uint16_t pressureDpa;    // Pressure in 10 Pa (0.1 hPa)
  int16_t relAltDm;        // Relative altitude in 0.1 m

  int32_t lat1e7;          // Latitude * 10^7 (WGS84)
  int32_t lon1e7;          // Longitude * 10^7 (WGS84)
  int16_t altM;            // Altitude above sea level in meters
  uint16_t speedCms;       // Speed in cm/s (0.01 m/s)
  uint16_t courseCdeg;     // Heading/course in 0.01 degrees (0..35999)
  uint8_t gpsFix;          // 0: NoFix, 1: Searching, 2: 2D, 3: 3D
  uint8_t satellites;      // Number of satellites tracked

  int32_t weightGrams;     // Loadcell weight in grams (-5000 .. +5000)
  uint8_t weightStatus;    // 0: Offline, 1: Initializing, 2: Healthy, 3: Stale, 4: Fault

  uint8_t estopState;      // 0: Safe, 1: Warning, 2: Critical, 3: EmergencyStop, 4: SensorFault
  uint8_t estopCut;        // 0: Relay closed/safe, 1: Relay cut applied
  int16_t nearestMm;       // Nearest detected obstacle in mm (-1 if none)

  uint16_t crc16;          // CRC-16-CCITT computed over bytes 0 .. 62
};
#pragma pack(pop)

static_assert(sizeof(LoraTelemetryPacket) == kLoraPacketPayloadSize,
              "LoraTelemetryPacket size must exactly equal 65 bytes");

inline uint16_t calculateCrc16(const uint8_t* data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; ++i) {
    crc ^= (static_cast<uint16_t>(data[i]) << 8);
    for (uint8_t bit = 0; bit < 8; ++bit) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
    }
  }
  return crc;
}

inline bool verifyPacketCrc(const LoraTelemetryPacket& packet) {
  const uint16_t computed = calculateCrc16(
      reinterpret_cast<const uint8_t*>(&packet),
      sizeof(LoraTelemetryPacket) - sizeof(uint16_t));
  return computed == packet.crc16;
}

inline void stampPacketCrc(LoraTelemetryPacket& packet) {
  packet.crc16 = calculateCrc16(
      reinterpret_cast<const uint8_t*>(&packet),
      sizeof(LoraTelemetryPacket) - sizeof(uint16_t));
}

}  // namespace fogsen
