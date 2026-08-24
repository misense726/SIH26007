#pragma once

#include <Arduino.h>
#include <VL53L0X.h>
#include <VL53L1X.h>
#include <Wire.h>

#include <stdlib.h>
#include <string.h>

#ifndef FOGSEN_DEBUG_LOGS
#define FOGSEN_DEBUG_LOGS 1
#endif

namespace fogsen {

constexpr int16_t kInvalidRangeMm = -1;

enum NodeHealthBit : uint8_t {
  kScannerHealthy = 1U << 0,
  kFixedAHealthy = 1U << 1,
  kFixedBHealthy = 1U << 2,
  kTcaHealthy = 1U << 3,
  kServoHealthy = 1U << 4,
};

struct NodeConfig {
  const char *node_id;
  const char *boot_message;
  const char *fixed_a_json_key;
  const char *fixed_b_json_key;

  uint8_t i2c_sda_pin;
  uint8_t i2c_scl_pin;
  uint8_t uart_tx_pin;
  uint8_t uart_rx_pin;
  uint8_t servo_pwm_pin;

  uint8_t tca_address;
  uint8_t scanner_tca_channel;
  uint8_t fixed_a_tca_channel;
  uint8_t fixed_b_tca_channel;

  uint32_t debug_baud;
  uint32_t node_uart_baud;
  uint32_t i2c_clock_hz;
  uint16_t i2c_bus_timeout_ms;
  uint16_t sensor_read_timeout_ms;
  uint32_t sensor_retry_ms;

  int16_t scan_min_deg;
  int16_t scan_max_deg;
  int16_t scan_step_deg;
  int16_t servo_center_deg;
  int16_t servo_min_angle_deg;
  int16_t servo_max_angle_deg;
  uint16_t servo_min_pulse_us;
  uint16_t servo_max_pulse_us;
  uint32_t servo_frequency_hz;
  uint8_t servo_resolution_bits;

  uint16_t default_settle_ms;
  uint16_t min_settle_ms;
  uint16_t max_settle_ms;
  uint16_t fixed_only_period_ms;

  uint32_t scanner_timing_budget_us;
  uint16_t scanner_max_range_mm;
  uint32_t fixed_timing_budget_us;
  uint16_t fixed_max_range_mm;
};

class XiaoSensorNode {
 public:
  explicit XiaoSensorNode(const NodeConfig &config) : config_(config) {}

  void begin() {
    Serial.begin(config_.debug_baud);
    Serial1.begin(
        config_.node_uart_baud,
        SERIAL_8N1,
        config_.uart_rx_pin,
        config_.uart_tx_pin);

    Wire.begin(config_.i2c_sda_pin, config_.i2c_scl_pin);
    Wire.setClock(config_.i2c_clock_hz);
    Wire.setTimeOut(config_.i2c_bus_timeout_ms);

    servo_healthy_ = ledcAttach(
        config_.servo_pwm_pin,
        config_.servo_frequency_hz,
        config_.servo_resolution_bits);
    if (servo_healthy_) {
      servo_healthy_ = writeServoAngle(config_.servo_center_deg);
    }

    disableTcaChannels();

    const uint32_t now = millis();
    initializeScanner(now);
    initializeFixedSensor(fixed_a_sensor_, fixed_a_state_, config_.fixed_a_tca_channel, now);
    initializeFixedSensor(fixed_b_sensor_, fixed_b_state_, config_.fixed_b_tca_channel, now);

    current_angle_deg_ = config_.scan_min_deg;
    scan_direction_ = 1;
    if (servo_healthy_) {
      servo_healthy_ = writeServoAngle(current_angle_deg_);
    }
    next_scan_sample_ms_ = millis() + settle_ms_;
    next_fixed_sample_ms_ = millis() + config_.fixed_only_period_ms;
    acquisition_phase_ = AcquisitionPhase::kServoSettling;

#if FOGSEN_DEBUG_LOGS
    Serial.println(config_.boot_message);
#endif
    sendSimpleReply("BOOT");
  }

  void update() {
    pollCommands();

    const uint32_t now = millis();
    retryMissingSensors(now);

    if (scan_enabled_) {
      if (acquisition_phase_ == AcquisitionPhase::kScannerWaiting) {
        pollScannerMeasurement(now);
      } else if (timeReached(now, next_scan_sample_ms_)) {
        startScannerMeasurement(now);
      }
      return;
    }

    if (timeReached(now, next_fixed_sample_ms_)) {
      sampleFixedOnly();
    }
  }

 private:
  enum class AcquisitionPhase : uint8_t {
    kServoSettling,
    kScannerWaiting,
  };

  struct SensorState {
    bool initialized = false;
    uint32_t last_init_attempt_ms = 0;
    uint32_t last_measurement_ms = 0;
  };

  static bool timeReached(uint32_t now, uint32_t deadline) {
    return static_cast<int32_t>(now - deadline) >= 0;
  }

  static bool elapsedAtLeast(uint32_t now, uint32_t then, uint32_t duration_ms) {
    return static_cast<uint32_t>(now - then) >= duration_ms;
  }

  bool selectTcaChannel(uint8_t channel) {
    if (channel > 7U) {
      tca_healthy_ = false;
      return false;
    }

    Wire.beginTransmission(config_.tca_address);
    Wire.write(static_cast<uint8_t>(1U << channel));
    tca_healthy_ = Wire.endTransmission() == 0;
    return tca_healthy_;
  }

  void disableTcaChannels() {
    Wire.beginTransmission(config_.tca_address);
    Wire.write(static_cast<uint8_t>(0));
    tca_healthy_ = Wire.endTransmission() == 0;
  }

  void initializeScanner(uint32_t now) {
    scanner_state_.last_init_attempt_ms = now;
    scanner_state_.initialized = false;

    if (!selectTcaChannel(config_.scanner_tca_channel)) {
      return;
    }

    scanner_sensor_.setBus(&Wire);
    scanner_sensor_.setTimeout(config_.sensor_read_timeout_ms);
    if (!scanner_sensor_.init()) {
      return;
    }

    scanner_sensor_.setDistanceMode(VL53L1X::Long);
    scanner_sensor_.setMeasurementTimingBudget(config_.scanner_timing_budget_us);
    scanner_state_.initialized = true;
    scanner_state_.last_measurement_ms = millis();
  }

  void initializeFixedSensor(
      VL53L0X &sensor,
      SensorState &state,
      uint8_t channel,
      uint32_t now) {
    state.last_init_attempt_ms = now;
    state.initialized = false;

    if (!selectTcaChannel(channel)) {
      return;
    }

    sensor.setBus(&Wire);
    sensor.setTimeout(config_.sensor_read_timeout_ms);
    if (!sensor.init()) {
      return;
    }

    sensor.setMeasurementTimingBudget(config_.fixed_timing_budget_us);
    state.initialized = true;
    state.last_measurement_ms = millis();
  }

  void retryMissingSensors(uint32_t now) {
    if (!scanner_state_.initialized &&
        elapsedAtLeast(now, scanner_state_.last_init_attempt_ms, config_.sensor_retry_ms)) {
      initializeScanner(now);
    }

    if (!fixed_a_state_.initialized &&
        elapsedAtLeast(now, fixed_a_state_.last_init_attempt_ms, config_.sensor_retry_ms)) {
      initializeFixedSensor(
          fixed_a_sensor_, fixed_a_state_, config_.fixed_a_tca_channel, now);
    }

    if (!fixed_b_state_.initialized &&
        elapsedAtLeast(now, fixed_b_state_.last_init_attempt_ms, config_.sensor_retry_ms)) {
      initializeFixedSensor(
          fixed_b_sensor_, fixed_b_state_, config_.fixed_b_tca_channel, now);
    }
  }

  bool startScannerSingleShot(uint32_t now) {
    if (!scanner_state_.initialized || !servo_healthy_) {
      return false;
    }

    if (!selectTcaChannel(config_.scanner_tca_channel)) {
      scanner_state_.initialized = false;
      scanner_state_.last_init_attempt_ms = now;
      return false;
    }

    scanner_sensor_.readSingle(false);
    scanner_measurement_started_ms_ = now;
    return true;
  }

  int16_t finishScannerSingleShot() {
    const uint16_t range_mm = scanner_sensor_.read(false);
    const bool timed_out = scanner_sensor_.timeoutOccurred();
    scanner_state_.last_measurement_ms = millis();

    if (timed_out) {
      scanner_state_.initialized = false;
      scanner_state_.last_init_attempt_ms = millis();
      return kInvalidRangeMm;
    }

    if (scanner_sensor_.ranging_data.range_status != VL53L1X::RangeValid ||
        range_mm == 0U ||
        range_mm > config_.scanner_max_range_mm) {
      return kInvalidRangeMm;
    }

    return static_cast<int16_t>(range_mm);
  }

  int16_t readFixedSensor(
      VL53L0X &sensor,
      SensorState &state,
      uint8_t channel) {
    if (!state.initialized) {
      return kInvalidRangeMm;
    }

    if (!selectTcaChannel(channel)) {
      state.initialized = false;
      state.last_init_attempt_ms = millis();
      return kInvalidRangeMm;
    }

    const uint16_t range_mm = sensor.readRangeSingleMillimeters();
    const bool timed_out = sensor.timeoutOccurred();
    state.last_measurement_ms = millis();

    if (timed_out) {
      state.initialized = false;
      state.last_init_attempt_ms = millis();
      return kInvalidRangeMm;
    }

    if (range_mm == 0U || range_mm > config_.fixed_max_range_mm) {
      return kInvalidRangeMm;
    }

    return static_cast<int16_t>(range_mm);
  }

  bool writeServoAngle(int16_t angle_deg) {
    if (!servo_healthy_) {
      return false;
    }

    const int16_t bounded_angle = constrain(
        angle_deg,
        config_.servo_min_angle_deg,
        config_.servo_max_angle_deg);
    const int32_t angle_span =
        config_.servo_max_angle_deg - config_.servo_min_angle_deg;
    if (angle_span <= 0) {
      return false;
    }

    const uint32_t pulse_span =
        config_.servo_max_pulse_us - config_.servo_min_pulse_us;
    const uint32_t pulse_us = config_.servo_min_pulse_us +
        (static_cast<uint32_t>(bounded_angle - config_.servo_min_angle_deg) * pulse_span) /
            static_cast<uint32_t>(angle_span);
    const uint32_t pwm_period_us = 1000000UL / config_.servo_frequency_hz;
    const uint32_t max_duty = (1UL << config_.servo_resolution_bits) - 1UL;
    const uint32_t duty = (pulse_us * max_duty) / pwm_period_us;

    const bool wrote = ledcWrite(config_.servo_pwm_pin, duty);
    if (wrote) {
      current_angle_deg_ = bounded_angle;
    }
    return wrote;
  }

  void startScannerMeasurement(uint32_t now) {
    pending_sample_ms_ = now;
    pending_sample_angle_deg_ = current_angle_deg_;
    if (!startScannerSingleShot(now)) {
      finishScanStep(kInvalidRangeMm);
      return;
    }
    acquisition_phase_ = AcquisitionPhase::kScannerWaiting;
  }

  void pollScannerMeasurement(uint32_t now) {
    if (!selectTcaChannel(config_.scanner_tca_channel)) {
      scanner_state_.initialized = false;
      scanner_state_.last_init_attempt_ms = now;
      finishScanStep(kInvalidRangeMm);
      return;
    }

    if (scanner_sensor_.dataReady()) {
      finishScanStep(finishScannerSingleShot());
      return;
    }

    if (elapsedAtLeast(
            now,
            scanner_measurement_started_ms_,
            config_.sensor_read_timeout_ms)) {
      scanner_state_.initialized = false;
      scanner_state_.last_init_attempt_ms = now;
      finishScanStep(kInvalidRangeMm);
    }
  }

  void finishScanStep(int16_t scanner_mm) {
    const int16_t fixed_a_mm = readFixedSensor(
        fixed_a_sensor_, fixed_a_state_, config_.fixed_a_tca_channel);
    const int16_t fixed_b_mm = readFixedSensor(
        fixed_b_sensor_, fixed_b_state_, config_.fixed_b_tca_channel);
    sendTelemetry(
        pending_sample_ms_,
        pending_sample_angle_deg_,
        scanner_mm,
        fixed_a_mm,
        fixed_b_mm);

    advanceScanAngle();
    if (!writeServoAngle(current_angle_deg_)) {
      servo_healthy_ = false;
    }
    acquisition_phase_ = AcquisitionPhase::kServoSettling;
    next_scan_sample_ms_ = millis() + settle_ms_;
  }

  void sampleFixedOnly() {
    const uint32_t sample_ms = millis();
    const int16_t fixed_a_mm = readFixedSensor(
        fixed_a_sensor_, fixed_a_state_, config_.fixed_a_tca_channel);
    const int16_t fixed_b_mm = readFixedSensor(
        fixed_b_sensor_, fixed_b_state_, config_.fixed_b_tca_channel);
    sendTelemetry(
        sample_ms,
        current_angle_deg_,
        kInvalidRangeMm,
        fixed_a_mm,
        fixed_b_mm);
    next_fixed_sample_ms_ = millis() + config_.fixed_only_period_ms;
  }

  void advanceScanAngle() {
    if (scan_direction_ > 0) {
      if (current_angle_deg_ >= config_.scan_max_deg) {
        scan_direction_ = -1;
        current_angle_deg_ = config_.scan_max_deg - config_.scan_step_deg;
      } else {
        current_angle_deg_ += config_.scan_step_deg;
      }
      return;
    }

    if (current_angle_deg_ <= config_.scan_min_deg) {
      scan_direction_ = 1;
      current_angle_deg_ = config_.scan_min_deg + config_.scan_step_deg;
    } else {
      current_angle_deg_ -= config_.scan_step_deg;
    }
  }

  uint8_t healthMask() const {
    uint8_t mask = 0;
    if (scanner_state_.initialized) {
      mask |= kScannerHealthy;
    }
    if (fixed_a_state_.initialized) {
      mask |= kFixedAHealthy;
    }
    if (fixed_b_state_.initialized) {
      mask |= kFixedBHealthy;
    }
    if (tca_healthy_) {
      mask |= kTcaHealthy;
    }
    if (servo_healthy_) {
      mask |= kServoHealthy;
    }
    return mask;
  }

  void sendTelemetry(
      uint32_t sample_ms,
      int16_t angle_deg,
      int16_t scanner_mm,
      int16_t fixed_a_mm,
      int16_t fixed_b_mm) {
    char packet[176];
    const uint32_t sequence = ++sequence_;
    const int written = snprintf(
        packet,
        sizeof(packet),
        "{\"node\":\"%s\",\"seq\":%lu,\"ms\":%lu,\"a\":%d,\"scan\":%d,\"%s\":%d,\"%s\":%d,\"ok\":%u}",
        config_.node_id,
        static_cast<unsigned long>(sequence),
        static_cast<unsigned long>(sample_ms),
        static_cast<int>(angle_deg),
        static_cast<int>(scanner_mm),
        config_.fixed_a_json_key,
        static_cast<int>(fixed_a_mm),
        config_.fixed_b_json_key,
        static_cast<int>(fixed_b_mm),
        static_cast<unsigned int>(healthMask()));
    writeLine(packet, written, sizeof(packet));
  }

  void sendSimpleReply(const char *reply) {
    char packet[112];
    const int written = snprintf(
        packet,
        sizeof(packet),
        "{\"node\":\"%s\",\"reply\":\"%s\",\"ms\":%lu}",
        config_.node_id,
        reply,
        static_cast<unsigned long>(millis()));
    writeLine(packet, written, sizeof(packet));
  }

  void sendStatusReply() {
    char packet[160];
    const int written = snprintf(
        packet,
        sizeof(packet),
        "{\"node\":\"%s\",\"reply\":\"STATUS\",\"ms\":%lu,\"ok\":%u,\"scan_on\":%u,\"settle\":%u}",
        config_.node_id,
        static_cast<unsigned long>(millis()),
        static_cast<unsigned int>(healthMask()),
        scan_enabled_ ? 1U : 0U,
        static_cast<unsigned int>(settle_ms_));
    writeLine(packet, written, sizeof(packet));
  }

  void writeLine(const char *packet, int written, size_t capacity) {
    if (written <= 0 || static_cast<size_t>(written) >= capacity) {
      return;
    }
    Serial1.write(reinterpret_cast<const uint8_t *>(packet), static_cast<size_t>(written));
    Serial1.write('\n');
  }

  void pollCommands() {
    uint8_t consumed = 0;
    while (Serial1.available() > 0 && consumed < 64U) {
      const int next = Serial1.read();
      if (next < 0) {
        break;
      }
      ++consumed;
      const char value = static_cast<char>(next);

      if (value == '\r') {
        continue;
      }
      if (value == '\n') {
        if (command_overflow_) {
          sendSimpleReply("ERROR_COMMAND_TOO_LONG");
        } else if (command_length_ > 0U) {
          command_buffer_[command_length_] = '\0';
          handleCommand(command_buffer_);
        }
        command_length_ = 0;
        command_overflow_ = false;
        continue;
      }

      if (command_overflow_) {
        continue;
      }
      if (command_length_ + 1U >= sizeof(command_buffer_)) {
        command_overflow_ = true;
        continue;
      }
      command_buffer_[command_length_++] = value;
    }
  }

  void handleCommand(const char *command) {
    if (strcmp(command, "PING") == 0) {
      sendSimpleReply("PONG");
      return;
    }
    if (strcmp(command, "STATUS") == 0) {
      sendStatusReply();
      return;
    }
    if (strcmp(command, "CENTER") == 0) {
      scan_enabled_ = false;
      acquisition_phase_ = AcquisitionPhase::kServoSettling;
      const bool centered = writeServoAngle(config_.servo_center_deg);
      servo_healthy_ = servo_healthy_ && centered;
      next_fixed_sample_ms_ = millis() + config_.sensor_read_timeout_ms;
      sendSimpleReply(centered ? "CENTERED" : "SERVO_ERROR");
      return;
    }
    if (strcmp(command, "SCAN_ON") == 0) {
      scan_enabled_ = true;
      acquisition_phase_ = AcquisitionPhase::kServoSettling;
      scan_direction_ = 1;
      current_angle_deg_ = config_.scan_min_deg;
      if (!writeServoAngle(current_angle_deg_)) {
        servo_healthy_ = false;
      }
      next_scan_sample_ms_ = millis() + settle_ms_;
      sendSimpleReply("SCAN_ON");
      return;
    }
    if (strcmp(command, "SCAN_OFF") == 0) {
      scan_enabled_ = false;
      acquisition_phase_ = AcquisitionPhase::kServoSettling;
      next_fixed_sample_ms_ = millis() + config_.sensor_read_timeout_ms;
      sendSimpleReply("SCAN_OFF");
      return;
    }
    if (strncmp(command, "SETTLE=", 7) == 0) {
      char *end = nullptr;
      const unsigned long requested = strtoul(command + 7, &end, 10);
      if (end != command + 7 && *end == '\0' &&
          requested >= config_.min_settle_ms &&
          requested <= config_.max_settle_ms) {
        settle_ms_ = static_cast<uint16_t>(requested);
        sendSimpleReply("SETTLE");
      } else {
        sendSimpleReply("ERROR_SETTLE_RANGE");
      }
      return;
    }

    sendSimpleReply("ERROR_UNKNOWN_COMMAND");
  }

  const NodeConfig &config_;
  VL53L1X scanner_sensor_;
  VL53L0X fixed_a_sensor_;
  VL53L0X fixed_b_sensor_;
  SensorState scanner_state_;
  SensorState fixed_a_state_;
  SensorState fixed_b_state_;

  bool tca_healthy_ = false;
  bool servo_healthy_ = false;
  bool scan_enabled_ = true;
  AcquisitionPhase acquisition_phase_ = AcquisitionPhase::kServoSettling;
  int8_t scan_direction_ = 1;
  int16_t current_angle_deg_ = 0;
  uint16_t settle_ms_ = config_.default_settle_ms;
  int16_t pending_sample_angle_deg_ = 0;
  uint32_t pending_sample_ms_ = 0;
  uint32_t scanner_measurement_started_ms_ = 0;
  uint32_t next_scan_sample_ms_ = 0;
  uint32_t next_fixed_sample_ms_ = 0;
  uint32_t sequence_ = 0;

  char command_buffer_[48] = {};
  uint8_t command_length_ = 0;
  bool command_overflow_ = false;
};

}  // namespace fogsen
