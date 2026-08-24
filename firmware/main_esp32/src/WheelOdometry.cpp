#include "WheelOdometry.h"

#include "TimeUtils.h"

namespace fogsen {

WheelOdometry::WheelOdometry(float wheelCircumferenceM,
                             uint8_t magnetsPerWheel,
                             float maximumPlausibleSpeedMps,
                             uint32_t speedHoldMs)
    : distancePerTickM_(magnetsPerWheel > 0
                            ? wheelCircumferenceM / magnetsPerWheel
                            : 0.0F),
      maximumPlausibleSpeedMps_(maximumPlausibleSpeedMps),
      speedHoldMs_(speedHoldMs),
      left_{0, 0, 0.0F},
      right_{0, 0, 0.0F},
      state_{0, 0, 0.0F, 0.0F, 0.0F} {}

void WheelOdometry::begin(uint32_t nowMs,
                          uint32_t leftTicks,
                          uint32_t rightTicks) {
  left_ = {leftTicks, nowMs, 0.0F};
  right_ = {rightTicks, nowMs, 0.0F};
  state_ = {leftTicks, rightTicks, 0.0F, 0.0F, 0.0F};
}

void WheelOdometry::reset(uint32_t nowMs,
                          uint32_t leftTicks,
                          uint32_t rightTicks) {
  begin(nowMs, leftTicks, rightTicks);
}

void WheelOdometry::updateWheel(uint32_t nowMs,
                                uint32_t ticks,
                                Estimator& estimator) {
  const uint32_t deltaTicks = static_cast<uint32_t>(ticks - estimator.lastTicks);
  if (deltaTicks > 0) {
    const uint32_t intervalMs = elapsedMs(nowMs, estimator.lastTickObservedMs);
    if (intervalMs > 0 && distancePerTickM_ > 0.0F) {
      float speed = static_cast<float>(deltaTicks) * distancePerTickM_ * 1000.0F /
                    static_cast<float>(intervalMs);
      if (speed > maximumPlausibleSpeedMps_) {
        speed = maximumPlausibleSpeedMps_;
      }
      estimator.speedMps = speed;
    }
    estimator.lastTickObservedMs = nowMs;
    estimator.lastTicks = ticks;
    return;
  }

  if (intervalElapsed(nowMs, estimator.lastTickObservedMs, speedHoldMs_)) {
    estimator.speedMps = 0.0F;
  }
}

void WheelOdometry::update(uint32_t nowMs,
                           uint32_t leftTicks,
                           uint32_t rightTicks) {
  updateWheel(nowMs, leftTicks, left_);
  updateWheel(nowMs, rightTicks, right_);

  state_.leftTicks = leftTicks;
  state_.rightTicks = rightTicks;
  state_.leftSpeedMps = left_.speedMps;
  state_.rightSpeedMps = right_.speedMps;
  state_.speedMps = (left_.speedMps + right_.speedMps) * 0.5F;
}

}  // namespace fogsen
