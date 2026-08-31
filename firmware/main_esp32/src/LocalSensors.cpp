#include "LocalSensors.h"

#include <math.h>

#include "FirmwareConfig.h"
#include "TimeUtils.h"

namespace fogsen {
namespace {

constexpr uint8_t kMpuAddresses[] = {0x68, 0x69};
constexpr uint8_t kBmpAddresses[] = {0x76, 0x77};
constexpr float kRadiansToDegrees = 57.2957795131F;
constexpr uint32_t kImuStaleMs = 250;
constexpr uint32_t kEnvironmentStaleMs = 1500;

bool finiteFloat(float value) {
  return isfinite(value);
}

}  // namespace

LocalSensors::LocalSensors(TwoWire& wire)
    : wire_(wire),
      mpu_(),
      bmp_(&wire),
      imuInitialized_(false),
      bmpInitialized_(false),
      imuAddress_(0),
      bmpAddress_(0),
      imuConsecutiveFailures_(0),
      bmpConsecutiveFailures_(0),
      imuReadFailures_(0),
      environmentReadFailures_(0),
      nextImuRetryMs_(0),
      nextBmpRetryMs_(0),
      lastImuAttemptMs_(0),
      lastBmpAttemptMs_(0),
      imuCalibrationSamples_(0),
      imuAccelerationReferenceX_(0.0F),
      imuAccelerationReferenceY_(0.0F),
      imuAccelerationReferenceZ_(0.0F),
      imuAccelerationSumX_(0.0F),
      imuAccelerationSumY_(0.0F),
      imuAccelerationSumZ_(0.0F),
      imuGyroSumX_(0.0F),
      imuGyroSumY_(0.0F),
      imuGyroSumZ_(0.0F),
      imuAccelerationBiasX_(0.0F),
      imuAccelerationBiasY_(0.0F),
      imuAccelerationBiasZ_(0.0F),
      imuGyroBiasX_(0.0F),
      imuGyroBiasY_(0.0F),
      imuGyroBiasZ_(0.0F),
      baselinePressureSumHpa_(0.0F),
      baselinePressureSamples_(0),
      imuReading_{false, false, true, 0, 0, 0.0F, 0.0F, 0.0F,
                  0.0F, 0.0F, 0.0F, 0.0F},
      environmentReading_{false, false, 0, 0.0F, 0.0F, 0.0F, 0.0F} {}

void LocalSensors::begin(uint32_t nowMs) {
  nextImuRetryMs_ = nowMs;
  nextBmpRetryMs_ = nowMs;
  lastImuAttemptMs_ = nowMs - config::kImuPeriodMs;
  lastBmpAttemptMs_ = nowMs - config::kEnvironmentPeriodMs;
  initializeImu(nowMs);
  initializeBmp(nowMs);
}

bool LocalSensors::probe(uint8_t address) {
  wire_.beginTransmission(address);
  return wire_.endTransmission() == 0;
}

bool LocalSensors::initializeImu(uint32_t nowMs) {
  imuInitialized_ = false;
  imuAddress_ = 0;
  imuReading_.hasSample = false;
  imuReading_.calibrated = false;
  imuReading_.zeroing = false;
  for (size_t index = 0; index < sizeof(kMpuAddresses); ++index) {
    const uint8_t address = kMpuAddresses[index];
    if (!probe(address)) {
      continue;
    }
    if (mpu_.begin(address, &wire_)) {
      mpu_.setAccelerometerRange(MPU6050_RANGE_8_G);
      mpu_.setGyroRange(MPU6050_RANGE_500_DEG);
      mpu_.setFilterBandwidth(MPU6050_BAND_21_HZ);
      imuAddress_ = address;
      imuInitialized_ = true;
      imuConsecutiveFailures_ = 0;
      restartImuCalibration(nowMs);
      return true;
    }
  }
  nextImuRetryMs_ = nowMs + config::kSensorRetryMs;
  return false;
}

void LocalSensors::restartImuCalibration(uint32_t nowMs) {
  imuCalibrationSamples_ = 0;
  imuAccelerationReferenceX_ = 0.0F;
  imuAccelerationReferenceY_ = 0.0F;
  imuAccelerationReferenceZ_ = 0.0F;
  imuAccelerationSumX_ = 0.0F;
  imuAccelerationSumY_ = 0.0F;
  imuAccelerationSumZ_ = 0.0F;
  imuGyroSumX_ = 0.0F;
  imuGyroSumY_ = 0.0F;
  imuGyroSumZ_ = 0.0F;
  imuAccelerationBiasX_ = 0.0F;
  imuAccelerationBiasY_ = 0.0F;
  imuAccelerationBiasZ_ = 0.0F;
  imuGyroBiasX_ = 0.0F;
  imuGyroBiasY_ = 0.0F;
  imuGyroBiasZ_ = 0.0F;
  imuReading_.calibrated = false;
  imuReading_.zeroing = true;
  imuReading_.zeroedMs = 0;
  imuReading_.updatedMs = nowMs;
  imuReading_.accelerationXMps2 = 0.0F;
  imuReading_.accelerationYMps2 = 0.0F;
  imuReading_.accelerationZMps2 = 0.0F;
  imuReading_.gyroXDps = 0.0F;
  imuReading_.gyroYDps = 0.0F;
  imuReading_.gyroZDps = 0.0F;
}

bool LocalSensors::collectImuCalibrationSample(uint32_t nowMs,
                                               float accelerationX,
                                               float accelerationY,
                                               float accelerationZ,
                                               float gyroX,
                                               float gyroY,
                                               float gyroZ) {
  const float gyroMaximum =
      fmaxf(fabsf(gyroX), fmaxf(fabsf(gyroY), fabsf(gyroZ)));
  if (gyroMaximum > config::kImuZeroMaxGyroDps) {
    restartImuCalibration(nowMs);
    return false;
  }

  if (imuCalibrationSamples_ == 0) {
    imuAccelerationReferenceX_ = accelerationX;
    imuAccelerationReferenceY_ = accelerationY;
    imuAccelerationReferenceZ_ = accelerationZ;
  } else {
    const float deltaX = accelerationX - imuAccelerationReferenceX_;
    const float deltaY = accelerationY - imuAccelerationReferenceY_;
    const float deltaZ = accelerationZ - imuAccelerationReferenceZ_;
    const float delta = sqrtf(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
    if (delta > config::kImuZeroMaxAccelDeltaMps2) {
      restartImuCalibration(nowMs);
      return false;
    }
  }

  imuAccelerationSumX_ += accelerationX;
  imuAccelerationSumY_ += accelerationY;
  imuAccelerationSumZ_ += accelerationZ;
  imuGyroSumX_ += gyroX;
  imuGyroSumY_ += gyroY;
  imuGyroSumZ_ += gyroZ;
  ++imuCalibrationSamples_;
  if (imuCalibrationSamples_ < config::kImuZeroSampleCount) {
    return false;
  }

  const float sampleCount = static_cast<float>(imuCalibrationSamples_);
  imuAccelerationBiasX_ = imuAccelerationSumX_ / sampleCount;
  imuAccelerationBiasY_ = imuAccelerationSumY_ / sampleCount;
  imuAccelerationBiasZ_ = imuAccelerationSumZ_ / sampleCount;
  imuGyroBiasX_ = imuGyroSumX_ / sampleCount;
  imuGyroBiasY_ = imuGyroSumY_ / sampleCount;
  imuGyroBiasZ_ = imuGyroSumZ_ / sampleCount;
  imuReading_.calibrated = true;
  imuReading_.zeroing = false;
  imuReading_.zeroedMs = nowMs;
  return true;
}

void LocalSensors::restartAltitudeBaseline() {
  baselinePressureSumHpa_ = 0.0F;
  baselinePressureSamples_ = 0;
  environmentReading_.relativeAltitudeReady = false;
  environmentReading_.relativeAltitudeM = 0.0F;
  environmentReading_.baselinePressureHpa = 0.0F;
}

bool LocalSensors::initializeBmp(uint32_t nowMs) {
  bmpInitialized_ = false;
  bmpAddress_ = 0;
  environmentReading_.hasSample = false;
  restartAltitudeBaseline();
  for (size_t index = 0; index < sizeof(kBmpAddresses); ++index) {
    const uint8_t address = kBmpAddresses[index];
    if (!probe(address)) {
      continue;
    }
    if (bmp_.begin(address)) {
      bmp_.setSampling(Adafruit_BMP280::MODE_NORMAL,
                       Adafruit_BMP280::SAMPLING_X2,
                       Adafruit_BMP280::SAMPLING_X16,
                       Adafruit_BMP280::FILTER_X4,
                       Adafruit_BMP280::STANDBY_MS_250);
      bmpAddress_ = address;
      bmpInitialized_ = true;
      bmpConsecutiveFailures_ = 0;
      restartAltitudeBaseline();
      return true;
    }
  }
  nextBmpRetryMs_ = nowMs + config::kSensorRetryMs;
  return false;
}

void LocalSensors::readImu(uint32_t nowMs) {
  sensors_event_t acceleration;
  sensors_event_t gyro;
  sensors_event_t temperature;
  const bool readOk = mpu_.getEvent(&acceleration, &gyro, &temperature);
  const float normSquared =
      acceleration.acceleration.x * acceleration.acceleration.x +
      acceleration.acceleration.y * acceleration.acceleration.y +
      acceleration.acceleration.z * acceleration.acceleration.z;
  const float norm = sqrtf(normSquared);
  const bool valuesValid =
      readOk && finiteFloat(norm) &&
      norm >= config::kMpuMinAccelerationNormMps2 &&
      norm <= config::kMpuMaxAccelerationNormMps2 &&
      finiteFloat(gyro.gyro.x) && finiteFloat(gyro.gyro.y) &&
      finiteFloat(gyro.gyro.z) && finiteFloat(temperature.temperature);

  if (!valuesValid) {
    ++imuReadFailures_;
    if (imuConsecutiveFailures_ < UINT8_MAX) {
      ++imuConsecutiveFailures_;
    }
    if (imuConsecutiveFailures_ >= config::kSensorFailureLimit) {
      imuInitialized_ = false;
      imuReading_.hasSample = false;
      imuReading_.calibrated = false;
      imuReading_.zeroing = false;
      nextImuRetryMs_ = nowMs + config::kSensorRetryMs;
    }
    return;
  }

  imuConsecutiveFailures_ = 0;
  imuReading_.hasSample = true;
  imuReading_.updatedMs = nowMs;
  const float gyroXDps = gyro.gyro.x * kRadiansToDegrees;
  const float gyroYDps = gyro.gyro.y * kRadiansToDegrees;
  const float gyroZDps = gyro.gyro.z * kRadiansToDegrees;
  if (imuReading_.zeroing) {
    collectImuCalibrationSample(nowMs, acceleration.acceleration.x,
                                acceleration.acceleration.y,
                                acceleration.acceleration.z, gyroXDps,
                                gyroYDps, gyroZDps);
  }
  if (imuReading_.calibrated) {
    imuReading_.accelerationXMps2 =
        acceleration.acceleration.x - imuAccelerationBiasX_;
    imuReading_.accelerationYMps2 =
        acceleration.acceleration.y - imuAccelerationBiasY_;
    imuReading_.accelerationZMps2 =
        acceleration.acceleration.z - imuAccelerationBiasZ_;
    imuReading_.gyroXDps = gyroXDps - imuGyroBiasX_;
    imuReading_.gyroYDps = gyroYDps - imuGyroBiasY_;
    imuReading_.gyroZDps = gyroZDps - imuGyroBiasZ_;
  } else {
    imuReading_.accelerationXMps2 = 0.0F;
    imuReading_.accelerationYMps2 = 0.0F;
    imuReading_.accelerationZMps2 = 0.0F;
    imuReading_.gyroXDps = 0.0F;
    imuReading_.gyroYDps = 0.0F;
    imuReading_.gyroZDps = 0.0F;
  }
  imuReading_.temperatureC = temperature.temperature;
}

void LocalSensors::readEnvironment(uint32_t nowMs) {
  const float temperatureC = bmp_.readTemperature();
  const float pressureHpa = bmp_.readPressure() / 100.0F;
  const bool valuesValid =
      finiteFloat(temperatureC) && finiteFloat(pressureHpa) &&
      pressureHpa >= config::kBmpMinPressureHpa &&
      pressureHpa <= config::kBmpMaxPressureHpa;

  if (!valuesValid) {
    ++environmentReadFailures_;
    if (bmpConsecutiveFailures_ < UINT8_MAX) {
      ++bmpConsecutiveFailures_;
    }
    if (bmpConsecutiveFailures_ >= config::kSensorFailureLimit) {
      bmpInitialized_ = false;
      environmentReading_.hasSample = false;
      restartAltitudeBaseline();
      nextBmpRetryMs_ = nowMs + config::kSensorRetryMs;
    }
    return;
  }

  bmpConsecutiveFailures_ = 0;
  environmentReading_.hasSample = true;
  environmentReading_.updatedMs = nowMs;
  environmentReading_.temperatureC = temperatureC;
  environmentReading_.pressureHpa = pressureHpa;

  if (!environmentReading_.relativeAltitudeReady) {
    baselinePressureSumHpa_ += pressureHpa;
    ++baselinePressureSamples_;
    if (baselinePressureSamples_ >= config::kBmpBaselineSamples) {
      environmentReading_.baselinePressureHpa =
          baselinePressureSumHpa_ / static_cast<float>(baselinePressureSamples_);
      environmentReading_.relativeAltitudeReady = true;
    }
  }

  if (environmentReading_.relativeAltitudeReady &&
      environmentReading_.baselinePressureHpa > 0.0F) {
    const float ratio = pressureHpa / environmentReading_.baselinePressureHpa;
    environmentReading_.relativeAltitudeM =
        44330.0F * (1.0F - powf(ratio, 0.19029495F));
  }
}

void LocalSensors::poll(uint32_t nowMs) {
  if (!imuInitialized_ && timeReached(nowMs, nextImuRetryMs_)) {
    initializeImu(nowMs);
  }
  if (!bmpInitialized_ && timeReached(nowMs, nextBmpRetryMs_)) {
    initializeBmp(nowMs);
  }

  if (imuInitialized_ &&
      intervalElapsed(nowMs, lastImuAttemptMs_, config::kImuPeriodMs)) {
    lastImuAttemptMs_ = nowMs;
    readImu(nowMs);
  }
  if (bmpInitialized_ && intervalElapsed(nowMs, lastBmpAttemptMs_,
                                         config::kEnvironmentPeriodMs)) {
    lastBmpAttemptMs_ = nowMs;
    readEnvironment(nowMs);
  }
}

bool LocalSensors::zeroAltitude() {
  if (!bmpInitialized_ || !environmentReading_.hasSample ||
      environmentReading_.pressureHpa <= 0.0F) {
    return false;
  }
  baselinePressureSumHpa_ = environmentReading_.pressureHpa;
  baselinePressureSamples_ = 1;
  environmentReading_.baselinePressureHpa = environmentReading_.pressureHpa;
  environmentReading_.relativeAltitudeM = 0.0F;
  environmentReading_.relativeAltitudeReady = true;
  return true;
}

bool LocalSensors::zeroImu(uint32_t nowMs) {
  if (!imuInitialized_ || !imuReading_.hasSample) {
    return false;
  }
  restartImuCalibration(nowMs);
  return true;
}

uint32_t LocalSensors::imuAgeMs(uint32_t nowMs) const {
  return imuReading_.hasSample ? elapsedMs(nowMs, imuReading_.updatedMs)
                               : UINT32_MAX;
}

uint32_t LocalSensors::environmentAgeMs(uint32_t nowMs) const {
  return environmentReading_.hasSample
             ? elapsedMs(nowMs, environmentReading_.updatedMs)
             : UINT32_MAX;
}

LocalSensorStatus LocalSensors::imuStatus(uint32_t nowMs) const {
  if (!imuInitialized_) {
    return LocalSensorStatus::kOffline;
  }
  if (!imuReading_.hasSample) {
    return LocalSensorStatus::kInitializing;
  }
  if (imuReading_.zeroing || !imuReading_.calibrated) {
    return LocalSensorStatus::kInitializing;
  }
  if (imuAgeMs(nowMs) > kImuStaleMs) {
    return LocalSensorStatus::kStale;
  }
  return imuConsecutiveFailures_ > 0 ? LocalSensorStatus::kDegraded
                                     : LocalSensorStatus::kHealthy;
}

LocalSensorStatus LocalSensors::environmentStatus(uint32_t nowMs) const {
  if (!bmpInitialized_) {
    return LocalSensorStatus::kOffline;
  }
  if (!environmentReading_.hasSample) {
    return LocalSensorStatus::kInitializing;
  }
  if (environmentAgeMs(nowMs) > kEnvironmentStaleMs) {
    return LocalSensorStatus::kStale;
  }
  return bmpConsecutiveFailures_ > 0 ? LocalSensorStatus::kDegraded
                                     : LocalSensorStatus::kHealthy;
}

const char* localSensorStatusName(LocalSensorStatus status) {
  switch (status) {
    case LocalSensorStatus::kOffline:
      return "OFFLINE";
    case LocalSensorStatus::kInitializing:
      return "INITIALIZING";
    case LocalSensorStatus::kHealthy:
      return "HEALTHY";
    case LocalSensorStatus::kDegraded:
      return "DEGRADED";
    case LocalSensorStatus::kStale:
      return "STALE";
  }
  return "OFFLINE";
}

}  // namespace fogsen
