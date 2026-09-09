#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <SoftwareSerial.h>
#include <TinyGPS++.h>
#include <HX711.h>
#include <Preferences.h>
#include "Pins.h"
#include "LoadCellConfig.h"

namespace fogsen {
class GpsLoadSensors {
 public:
  void begin() {
    preferences_.begin("fogsen-load", false);
    zeroOffset_ = preferences_.getInt("zero", load_config::kZeroOffset);
    tared_ = zeroOffset_ != 0;
    gpsSerial_.begin(9600, SWSERIAL_8N1, pins::kGpsRx, -1, false, 1024);
    scale_.begin(pins::kLoadData, pins::kLoadClock);
  }
  bool startTare() {
    if (!hasLoad_ || taring_) return false;
    tareSum_ = 0;
    tareSamples_ = 0;
    tared_ = false;
    taring_ = true;
    return true;
  }
  void poll(uint32_t now) {
    unsigned consumed = 0;
    while (gpsSerial_.available() && consumed++ < 256) gps_.encode(gpsSerial_.read());
    if (scale_.is_ready()) {
      raw_ = scale_.read();
      loadMs_ = now;
      hasLoad_ = raw_ != -8388608L && raw_ != 8388607L;
      if (hasLoad_ && taring_) {
        tareSum_ += raw_;
        ++tareSamples_;
        if (tareSamples_ >= 32) {
          zeroOffset_ = static_cast<int32_t>(tareSum_ / tareSamples_);
          preferences_.putInt("zero", zeroOffset_);
          tared_ = true;
          taring_ = false;
        }
      }
    }
  }
  void addTelemetry(JsonObject gps, JsonObject load, uint32_t now) {
    const bool fix = gps_.location.isValid() && gps_.location.age() <= 5000;
    gps["fix"] = fix;
    gps["bytes"] = gps_.charsProcessed();
    gps["sats"] = gps_.satellites.isValid() && gps_.satellites.age() <= 5000 ? gps_.satellites.value() : 0;
    gps["lat"] = nullptr; gps["lon"] = nullptr; gps["age"] = nullptr;
    gps["alt_m"] = nullptr; gps["speed_mps"] = nullptr; gps["hdop"] = nullptr;
    if (fix) {
      gps["lat"] = gps_.location.lat(); gps["lon"] = gps_.location.lng();
      gps["age"] = gps_.location.age();
      if (gps_.altitude.isValid() && gps_.altitude.age() <= 5000) gps["alt_m"] = gps_.altitude.meters();
      if (gps_.speed.isValid() && gps_.speed.age() <= 5000) gps["speed_mps"] = gps_.speed.mps();
      if (gps_.hdop.isValid() && gps_.hdop.age() <= 5000) gps["hdop"] = gps_.hdop.hdop();
    }
    const bool ready = hasLoad_ && now - loadMs_ <= load_config::kStaleMs;
    const bool calibrated = load_config::kCountsPerKg != 0.0F;
    load["ready"] = ready; load["tared"] = tared_; load["taring"] = taring_;
    load["calibrated"] = calibrated; load["zero_offset"] = tared_ ? zeroOffset_ : 0;
    load["raw"] = nullptr; load["net_raw"] = nullptr; load["kg"] = nullptr; load["age"] = nullptr;
    if (ready) {
      load["raw"] = raw_; load["age"] = now - loadMs_;
      if (tared_) load["net_raw"] = raw_ - zeroOffset_;
      if (calibrated && tared_) load["kg"] = (static_cast<double>(raw_) - zeroOffset_) / load_config::kCountsPerKg;
    }
  }
 private:
  SoftwareSerial gpsSerial_;
  TinyGPSPlus gps_;
  HX711 scale_;
  Preferences preferences_;
  int32_t raw_ = 0;
  int32_t zeroOffset_ = load_config::kZeroOffset;
  int64_t tareSum_ = 0;
  uint32_t loadMs_ = 0;
  uint8_t tareSamples_ = 0;
  bool hasLoad_ = false;
  bool tared_ = false;
  bool taring_ = false;
};
}
