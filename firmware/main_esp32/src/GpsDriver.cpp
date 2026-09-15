#include "GpsDriver.h"
#include "TimeUtils.h"

namespace fogsen {

GpsDriver::GpsDriver()
    : gps_(),
      reading_{false, GpsFixStatus::kNoHardware, 0, 0.0, 0.0, 0.0F, 0.0F, 0.0F, 0, 99.9F},
      lastCharReceivedMs_(0),
      lastFixUpdateMs_(0) {}

void GpsDriver::begin(uint32_t nowMs) {
  lastCharReceivedMs_ = nowMs;
  lastFixUpdateMs_ = 0;
  reading_.fixStatus = GpsFixStatus::kNoHardware;
  reading_.hasFix = false;
}

void GpsDriver::poll(Stream& serialStream, uint32_t nowMs) {
  size_t bytesProcessed = 0;

  while (serialStream.available() > 0 && bytesProcessed < kMaxBytesPerPoll) {
    const char c = static_cast<char>(serialStream.read());
    gps_.encode(c);
    lastCharReceivedMs_ = nowMs;
    ++bytesProcessed;
  }

  evaluateFixState(nowMs);
}

void GpsDriver::evaluateFixState(uint32_t nowMs) {
  if (elapsedMs(nowMs, lastCharReceivedMs_) > kHardwareTimeoutMs) {
    reading_.fixStatus = GpsFixStatus::kNoHardware;
    reading_.hasFix = false;
    return;
  }

  const bool locationValid = gps_.location.isValid();
  const uint32_t locationAge = gps_.location.age();
  const uint32_t satellites = gps_.satellites.isValid() ? gps_.satellites.value() : 0;
  const float hdop = gps_.hdop.isValid() ? static_cast<float>(gps_.hdop.hdop()) : 99.9F;

  if (!locationValid || satellites < 3 || locationAge > kFixStaleThresholdMs) {
    reading_.fixStatus = (gps_.charsProcessed() > 50) ? GpsFixStatus::kSearching
                                                      : GpsFixStatus::kNoHardware;
    reading_.hasFix = false;
    return;
  }

  if (satellites >= kMinSatellitesFor3DFix && hdop <= kMaxHdopFor3DFix) {
    reading_.fixStatus = GpsFixStatus::kFix3D;
  } else {
    reading_.fixStatus = GpsFixStatus::kFix2D;
  }

  reading_.hasFix = true;
  reading_.updatedMs = nowMs;
  lastFixUpdateMs_ = nowMs;

  reading_.latitudeDeg = gps_.location.lat();
  reading_.longitudeDeg = gps_.location.lng();
  reading_.altitudeM = gps_.altitude.isValid() ? static_cast<float>(gps_.altitude.meters()) : 0.0F;
  reading_.speedMps = gps_.speed.isValid() ? static_cast<float>(gps_.speed.mps()) : 0.0F;
  reading_.courseDeg = gps_.course.isValid() ? static_cast<float>(gps_.course.deg()) : 0.0F;
  reading_.satellites = satellites;
  reading_.hdop = hdop;
}

uint32_t GpsDriver::sampleAgeMs(uint32_t nowMs) const {
  return elapsedMs(nowMs, reading_.updatedMs);
}

const char* gpsFixStatusName(GpsFixStatus status) {
  switch (status) {
    case GpsFixStatus::kNoHardware:
      return "NO_HARDWARE";
    case GpsFixStatus::kSearching:
      return "SEARCHING";
    case GpsFixStatus::kFix2D:
      return "FIX_2D";
    case GpsFixStatus::kFix3D:
      return "FIX_3D";
    case GpsFixStatus::kStale:
      return "STALE";
    default:
      return "UNKNOWN";
  }
}

}  // namespace fogsen
