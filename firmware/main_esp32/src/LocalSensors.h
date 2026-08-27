#pragma once

#include <Adafruit_BMP280.h>
#include <Adafruit_MPU6050.h>
#include <Arduino.h>
#include <Wire.h>
#include <stdint.h>

namespace fogsen {

enum class LocalSensorStatus : uint8_t {
  kOffline,
  kInitializing,
  kHealthy,
  kDegraded,
  kStale,
};

struct ImuReading {
  bool hasSample;
  bool calibrated;
  bool zeroing;
  uint32_t updatedMs;
  uint32_t zeroedMs;
  float accelerationXMps2;
  float accelerationYMps2;
  float accelerationZMps2;
  float gyroXDps;
  float gyroYDps;
  float gyroZDps;
  float temperatureC;
};

struct EnvironmentReading {
  bool hasSample;
  bool relativeAltitudeReady;
  uint32_t updatedMs;
  float temperatureC;
  float pressureHpa;
  float relativeAltitudeM;
  float baselinePressureHpa;
};

class LocalSensors {
 public:
  explicit LocalSensors(TwoWire& wire);

  void begin(uint32_t nowMs);
  void poll(uint32_t nowMs);
  bool zeroImu(uint32_t nowMs);
  bool zeroAltitude();

  const ImuReading& imu() const { return imuReading_; }
  const EnvironmentReading& environment() const { return environmentReading_; }

  LocalSensorStatus imuStatus(uint32_t nowMs) const;
  LocalSensorStatus environmentStatus(uint32_t nowMs) const;
  uint32_t imuAgeMs(uint32_t nowMs) const;
  uint32_t environmentAgeMs(uint32_t nowMs) const;
  uint8_t imuAddress() const { return imuAddress_; }
  uint8_t bmpAddress() const { return bmpAddress_; }
  uint32_t imuReadFailures() const { return imuReadFailures_; }
  uint32_t environmentReadFailures() const { return environmentReadFailures_; }

 private:
  bool probe(uint8_t address);
  bool initializeImu(uint32_t nowMs);
  bool initializeBmp(uint32_t nowMs);
  void readImu(uint32_t nowMs);
  void readEnvironment(uint32_t nowMs);
  void restartImuCalibration(uint32_t nowMs);
  bool collectImuCalibrationSample(uint32_t nowMs,
                                   float accelerationX,
                                   float accelerationY,
                                   float accelerationZ,
                                   float gyroX,
                                   float gyroY,
                                   float gyroZ);
  void restartAltitudeBaseline();

  TwoWire& wire_;
  Adafruit_MPU6050 mpu_;
  Adafruit_BMP280 bmp_;

  bool imuInitialized_;
  bool bmpInitialized_;
  uint8_t imuAddress_;
  uint8_t bmpAddress_;
  uint8_t imuConsecutiveFailures_;
  uint8_t bmpConsecutiveFailures_;
  uint32_t imuReadFailures_;
  uint32_t environmentReadFailures_;
  uint32_t nextImuRetryMs_;
  uint32_t nextBmpRetryMs_;
  uint32_t lastImuAttemptMs_;
  uint32_t lastBmpAttemptMs_;

  uint16_t imuCalibrationSamples_;
  float imuAccelerationReferenceX_;
  float imuAccelerationReferenceY_;
  float imuAccelerationReferenceZ_;
  float imuAccelerationSumX_;
  float imuAccelerationSumY_;
  float imuAccelerationSumZ_;
  float imuGyroSumX_;
  float imuGyroSumY_;
  float imuGyroSumZ_;
  float imuAccelerationBiasX_;
  float imuAccelerationBiasY_;
  float imuAccelerationBiasZ_;
  float imuGyroBiasX_;
  float imuGyroBiasY_;
  float imuGyroBiasZ_;

  float baselinePressureSumHpa_;
  uint8_t baselinePressureSamples_;

  ImuReading imuReading_;
  EnvironmentReading environmentReading_;
};

const char* localSensorStatusName(LocalSensorStatus status);

}  // namespace fogsen
