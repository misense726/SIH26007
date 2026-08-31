#pragma once

#include <Arduino.h>
#include <VL53L0X.h>
#include <Wire.h>

#include <string.h>

namespace fogsen {

constexpr int16_t kMiddleInvalidRangeMm = -1;
constexpr uint8_t kMiddleFixedAHealthy = 1U << 1;
constexpr uint8_t kMiddleFixedBHealthy = 1U << 2;

struct MiddleNodeConfig {
  const char* node_id;
  const char* boot_message;
  const char* fixed_a_json_key;
  const char* fixed_b_json_key;

  uint8_t i2c_sda_pin;
  uint8_t i2c_scl_pin;
  uint8_t uart_tx_pin;
  uint8_t uart_rx_pin;
  uint8_t fixed_a_xshut_pin;
  uint8_t fixed_b_xshut_pin;
  uint8_t fixed_a_i2c_address;
  uint8_t fixed_b_i2c_address;

  uint32_t debug_baud;
  uint32_t node_uart_baud;
  uint32_t i2c_clock_hz;
  uint16_t i2c_bus_timeout_ms;
  uint16_t sensor_read_timeout_ms;
  uint32_t sensor_retry_ms;
  uint16_t xshut_reset_us;
  uint16_t xshut_boot_us;
  uint16_t inter_sensor_guard_ms;
  uint16_t sample_period_ms;
  uint32_t fixed_timing_budget_us;
  uint16_t fixed_max_range_mm;
};

class MiddleFixedNode {
 public:
  explicit MiddleFixedNode(const MiddleNodeConfig& config) : config_(config) {}

  void begin() {
    Serial.begin(config_.debug_baud);
    Serial0.begin(config_.node_uart_baud, SERIAL_8N1, config_.uart_rx_pin,
                  config_.uart_tx_pin);

    holdAllSensorsInReset();
    configureI2cBus();
    runAddressSequence(millis());
    next_sample_ms_ = millis();

    Serial.println(config_.boot_message);
    sendSimpleReply("BOOT");
  }

  void update() {
    pollCommands();
    const uint32_t now = millis();

    if (address_recovery_pending_ && phase_ == Phase::kIdle &&
        timeReached(now, next_address_recovery_ms_)) {
      runAddressSequence(now);
    }

    if (phase_ == Phase::kFixedBGuard) {
      if (timeReached(now, next_sensor_action_ms_)) {
        sampleFixedB();
      }
      return;
    }

    if (timeReached(now, next_sample_ms_)) {
      sampleFixedA();
    }
  }

 private:
  enum class Phase : uint8_t { kIdle, kFixedBGuard };

  struct SensorState {
    bool initialized = false;
    uint32_t last_measurement_ms = 0;
  };

  static bool timeReached(uint32_t now, uint32_t deadline) {
    return static_cast<int32_t>(now - deadline) >= 0;
  }

  static void holdSensorInReset(uint8_t pin) {
    digitalWrite(pin, LOW);
    pinMode(pin, OUTPUT);
  }

  static void releaseSensorFromReset(uint8_t pin) {
    // XSHUT is not level shifted. High impedance lets the carrier pull it high.
    pinMode(pin, INPUT);
  }

  void holdAllSensorsInReset() {
    holdSensorInReset(config_.fixed_a_xshut_pin);
    holdSensorInReset(config_.fixed_b_xshut_pin);
  }

  void configureI2cBus() {
    Wire.end();
    clearI2cBus();
    Wire.begin(config_.i2c_sda_pin, config_.i2c_scl_pin);
    Wire.setClock(config_.i2c_clock_hz);
    Wire.setTimeOut(config_.i2c_bus_timeout_ms);
  }

  void clearI2cBus() {
    pinMode(config_.i2c_sda_pin, INPUT);
    pinMode(config_.i2c_scl_pin, INPUT);
    delayMicroseconds(10);

    for (uint8_t pulse = 0; pulse < 16U &&
                            digitalRead(config_.i2c_sda_pin) == LOW;
         ++pulse) {
      digitalWrite(config_.i2c_scl_pin, LOW);
      pinMode(config_.i2c_scl_pin, OUTPUT_OPEN_DRAIN);
      delayMicroseconds(5);
      pinMode(config_.i2c_scl_pin, INPUT);
      delayMicroseconds(5);
    }

    digitalWrite(config_.i2c_sda_pin, LOW);
    pinMode(config_.i2c_sda_pin, OUTPUT_OPEN_DRAIN);
    delayMicroseconds(5);
    pinMode(config_.i2c_scl_pin, INPUT);
    delayMicroseconds(5);
    pinMode(config_.i2c_sda_pin, INPUT);
    delayMicroseconds(5);
  }

  bool probe(uint8_t address) {
    Wire.beginTransmission(address);
    return Wire.endTransmission() == 0;
  }

  bool initializeFixed(VL53L0X& sensor, SensorState& state,
                       uint8_t xshut_pin, uint8_t runtime_address) {
    state.initialized = false;
    releaseSensorFromReset(xshut_pin);
    delayMicroseconds(config_.xshut_boot_us);
    if (!probe(0x29)) {
      holdSensorInReset(xshut_pin);
      return false;
    }

    sensor = VL53L0X();
    sensor.setBus(&Wire);
    sensor.setTimeout(config_.sensor_read_timeout_ms);
    if (!sensor.init()) {
      holdSensorInReset(xshut_pin);
      return false;
    }
    sensor.setAddress(runtime_address);
    if (!probe(runtime_address)) {
      holdSensorInReset(xshut_pin);
      return false;
    }
    sensor.setMeasurementTimingBudget(config_.fixed_timing_budget_us);
    state.initialized = true;
    state.last_measurement_ms = millis();
    return true;
  }

  void runAddressSequence(uint32_t now) {
    phase_ = Phase::kIdle;
    holdAllSensorsInReset();
    delayMicroseconds(config_.xshut_reset_us);
    configureI2cBus();

    const bool fixed_a_ready = initializeFixed(
        fixed_a_sensor_, fixed_a_state_, config_.fixed_a_xshut_pin,
        config_.fixed_a_i2c_address);
    const bool fixed_b_ready = initializeFixed(
        fixed_b_sensor_, fixed_b_state_, config_.fixed_b_xshut_pin,
        config_.fixed_b_i2c_address);

    address_recovery_pending_ = !(fixed_a_ready && fixed_b_ready);
    next_address_recovery_ms_ = now + config_.sensor_retry_ms;
    next_sample_ms_ = millis();
  }

  void scheduleRecovery(uint32_t now) {
    address_recovery_pending_ = true;
    next_address_recovery_ms_ = now;
  }

  int16_t readFixed(VL53L0X& sensor, SensorState& state,
                    uint8_t runtime_address) {
    if (!state.initialized) {
      return kMiddleInvalidRangeMm;
    }

    const uint32_t now = millis();
    if (!probe(runtime_address)) {
      state.initialized = false;
      scheduleRecovery(now);
      return kMiddleInvalidRangeMm;
    }

    const uint16_t range_mm = sensor.readRangeSingleMillimeters();
    state.last_measurement_ms = millis();
    if (sensor.timeoutOccurred() || !probe(runtime_address)) {
      state.initialized = false;
      scheduleRecovery(millis());
      return kMiddleInvalidRangeMm;
    }
    if (range_mm == 0U || range_mm > config_.fixed_max_range_mm) {
      return kMiddleInvalidRangeMm;
    }
    return static_cast<int16_t>(range_mm);
  }

  void sampleFixedA() {
    pending_fixed_a_mm_ = readFixed(
        fixed_a_sensor_, fixed_a_state_, config_.fixed_a_i2c_address);
    pending_fixed_a_ms_ = millis();
    phase_ = Phase::kFixedBGuard;
    next_sensor_action_ms_ = millis() + config_.inter_sensor_guard_ms;
  }

  void sampleFixedB() {
    pending_fixed_b_mm_ = readFixed(
        fixed_b_sensor_, fixed_b_state_, config_.fixed_b_i2c_address);
    pending_fixed_b_ms_ = millis();
    sendTelemetry();
    phase_ = Phase::kIdle;
    next_sample_ms_ = millis() + config_.sample_period_ms;
  }

  uint8_t healthMask() const {
    uint8_t mask = 0;
    if (fixed_a_state_.initialized) {
      mask |= kMiddleFixedAHealthy;
    }
    if (fixed_b_state_.initialized) {
      mask |= kMiddleFixedBHealthy;
    }
    return mask;
  }

  void sendTelemetry() {
    char packet[176];
    const uint32_t packet_ms = millis();
    const int written = snprintf(
        packet, sizeof(packet),
        "{\"node\":\"%s\",\"seq\":%lu,\"ms\":%lu,\"%s\":%d,\"%s_ms\":%lu,\"%s\":%d,\"%s_ms\":%lu,\"ok\":%u}",
        config_.node_id, static_cast<unsigned long>(++sequence_),
        static_cast<unsigned long>(packet_ms), config_.fixed_a_json_key,
        static_cast<int>(pending_fixed_a_mm_), config_.fixed_a_json_key,
        static_cast<unsigned long>(pending_fixed_a_ms_),
        config_.fixed_b_json_key, static_cast<int>(pending_fixed_b_mm_),
        config_.fixed_b_json_key,
        static_cast<unsigned long>(pending_fixed_b_ms_),
        static_cast<unsigned int>(healthMask()));
    writeLine(packet, written, sizeof(packet));
  }

  void sendSimpleReply(const char* reply) {
    char packet[128];
    const int written = snprintf(
        packet, sizeof(packet),
        "{\"node\":\"%s\",\"reply\":\"%s\",\"ms\":%lu}",
        config_.node_id, reply, static_cast<unsigned long>(millis()));
    writeLine(packet, written, sizeof(packet));
  }

  void sendStatusReply() {
    char packet[160];
    const int written = snprintf(
        packet, sizeof(packet),
        "{\"node\":\"%s\",\"reply\":\"STATUS\",\"ms\":%lu,\"ok\":%u,\"guard\":%u}",
        config_.node_id, static_cast<unsigned long>(millis()),
        static_cast<unsigned int>(healthMask()),
        static_cast<unsigned int>(config_.inter_sensor_guard_ms));
    writeLine(packet, written, sizeof(packet));
  }

  void writeLine(const char* packet, int written, size_t capacity) {
    if (written <= 0 || static_cast<size_t>(written) >= capacity) {
      return;
    }
    Serial0.write(reinterpret_cast<const uint8_t*>(packet),
                  static_cast<size_t>(written));
    Serial0.write('\n');
  }

  void pollCommands() {
    uint8_t consumed = 0;
    while (Serial0.available() > 0 && consumed < 64U) {
      const int next = Serial0.read();
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

  void handleCommand(const char* command) {
    if (strcmp(command, "PING") == 0) {
      sendSimpleReply("PONG");
    } else if (strcmp(command, "STATUS") == 0) {
      sendStatusReply();
    } else if (strcmp(command, "RECOVER") == 0) {
      scheduleRecovery(millis());
      sendSimpleReply("RECOVERY_QUEUED");
    } else {
      sendSimpleReply("ERROR_UNKNOWN_COMMAND");
    }
  }

  const MiddleNodeConfig& config_;
  VL53L0X fixed_a_sensor_;
  VL53L0X fixed_b_sensor_;
  SensorState fixed_a_state_;
  SensorState fixed_b_state_;
  Phase phase_ = Phase::kIdle;
  bool address_recovery_pending_ = false;
  int16_t pending_fixed_a_mm_ = kMiddleInvalidRangeMm;
  int16_t pending_fixed_b_mm_ = kMiddleInvalidRangeMm;
  uint32_t pending_fixed_a_ms_ = 0;
  uint32_t pending_fixed_b_ms_ = 0;
  uint32_t next_sensor_action_ms_ = 0;
  uint32_t next_sample_ms_ = 0;
  uint32_t next_address_recovery_ms_ = 0;
  uint32_t sequence_ = 0;
  char command_buffer_[48] = {};
  uint8_t command_length_ = 0;
  bool command_overflow_ = false;
};

}  // namespace fogsen
