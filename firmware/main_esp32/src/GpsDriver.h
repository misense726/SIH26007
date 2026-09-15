#pragma once

#include <Arduino.h>
#include <Stream.h>
#include <TinyGPSPlus.h>
#include <stdint.h>

namespace fogsen {

enum class GpsFixStatus : uint8_t {
  kNoHardware = 0,
  kSearching = 1,
  kFix2D = 2,
  kFix3D = 3,
  kStale = 4
};

struct GpsReading {
  bool hasFix;
  GpsFixStatus fixStatus;
  uint32_t updatedMs;
  double latitudeDeg;
  double longitudeDeg;
  float altitudeM;
  float speedMps;
  float courseDeg;
  uint32_t satellites;
  float hdop;
};

class GpsDriver {
 public:
  GpsDriver();

  void begin(uint32_t nowMs);
  void poll(Stream& serialStream, uint32_t nowMs);

  const GpsReading& reading() const { return reading_; }
  GpsFixStatus fixStatus() const { return reading_.fixStatus; }
  bool hasFix() const { return reading_.hasFix; }
  uint32_t sampleAgeMs(uint32_t nowMs) const;

  uint32_t passedChecksumCount() const { return gps_.passedChecksum(); }
  uint32_t failedChecksumCount() const { return gps_.failedChecksum(); }
  uint32_t sentencesWithFixCount() const { return gps_.sentencesWithFix(); }

 private:
  void evaluateFixState(uint32_t nowMs);

  TinyGPSPlus gps_;
  GpsReading reading_;
  uint32_t lastCharReceivedMs_;
  uint32_t lastFixUpdateMs_;

  static constexpr size_t kMaxBytesPerPoll = 64;
  static constexpr uint32_t kHardwareTimeoutMs = 4000;
  static constexpr uint32_t kFixStaleThresholdMs = 3000;
  static constexpr float kMaxHdopFor3DFix = 3.5F;
  static constexpr uint32_t kMinSatellitesFor3DFix = 4;
};

const char* gpsFixStatusName(GpsFixStatus status);

}  // namespace fogsen
