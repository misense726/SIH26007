#pragma once

#include <stdint.h>

namespace fogsen {

struct WheelState {
  uint32_t leftTicks;
  uint32_t rightTicks;
  float leftSpeedMps;
  float rightSpeedMps;
  float speedMps;
};

class WheelOdometry {
 public:
  WheelOdometry(float wheelCircumferenceM,
                uint8_t magnetsPerWheel,
                float maximumPlausibleSpeedMps,
                uint32_t speedHoldMs);

  void begin(uint32_t nowMs, uint32_t leftTicks, uint32_t rightTicks);
  void update(uint32_t nowMs, uint32_t leftTicks, uint32_t rightTicks);
  void reset(uint32_t nowMs, uint32_t leftTicks, uint32_t rightTicks);

  const WheelState& state() const { return state_; }

 private:
  struct Estimator {
    uint32_t lastTicks;
    uint32_t lastTickObservedMs;
    float speedMps;
  };

  void updateWheel(uint32_t nowMs, uint32_t ticks, Estimator& estimator);

  float distancePerTickM_;
  float maximumPlausibleSpeedMps_;
  uint32_t speedHoldMs_;
  Estimator left_;
  Estimator right_;
  WheelState state_;
};

}  // namespace fogsen
