#pragma once

#include "../xiao_shared/include/FogSenXiaoNode.h"

namespace fogsen_front {

constexpr uint8_t kI2cSdaPin = 22;      // XIAO D4
constexpr uint8_t kI2cSclPin = 23;      // XIAO D5
constexpr uint8_t kNodeUartTxPin = 16;  // XIAO D6
constexpr uint8_t kNodeUartRxPin = 17;  // XIAO D7
constexpr uint8_t kServoPwmPin = 2;     // XIAO D2
constexpr uint8_t kScannerXshutPin = 0;  // XIAO D0
constexpr uint8_t kFrontXshutPin = 1;    // XIAO D1
constexpr uint8_t kUnusedXshutPin = 0xFF;

constexpr uint8_t kScannerI2cAddress = 0x30;
constexpr uint8_t kFrontI2cAddress = 0x31;
constexpr uint8_t kUnusedI2cAddress = 0x32;
constexpr uint16_t kNodeUartTxBufferBytes = 256;

constexpr int16_t kScanMinDeg = -80;
constexpr int16_t kScanMaxDeg = 80;
constexpr int16_t kScanStepDeg = 5;
constexpr int16_t kServoMinAngleDeg = -90;
constexpr int16_t kServoMaxAngleDeg = 90;
constexpr uint16_t kServoMinPulseUs = 500;
constexpr uint16_t kServoMaxPulseUs = 2500;
constexpr uint16_t kDefaultSettleMs = 30;
constexpr uint16_t kMinimumSettleMs = 20;
constexpr uint16_t kMaximumSettleMs = 100;

constexpr bool kPinsUnique =
    kScannerXshutPin != kFrontXshutPin &&
    kScannerXshutPin != kServoPwmPin &&
    kScannerXshutPin != kI2cSdaPin &&
    kScannerXshutPin != kI2cSclPin &&
    kScannerXshutPin != kNodeUartTxPin &&
    kScannerXshutPin != kNodeUartRxPin &&
    kFrontXshutPin != kServoPwmPin &&
    kFrontXshutPin != kI2cSdaPin &&
    kFrontXshutPin != kI2cSclPin &&
    kFrontXshutPin != kNodeUartTxPin &&
    kFrontXshutPin != kNodeUartRxPin &&
    kServoPwmPin != kI2cSdaPin &&
    kServoPwmPin != kI2cSclPin &&
    kServoPwmPin != kNodeUartTxPin &&
    kServoPwmPin != kNodeUartRxPin &&
    kI2cSdaPin != kI2cSclPin &&
    kI2cSdaPin != kNodeUartTxPin &&
    kI2cSdaPin != kNodeUartRxPin &&
    kI2cSclPin != kNodeUartTxPin &&
    kI2cSclPin != kNodeUartRxPin &&
    kNodeUartTxPin != kNodeUartRxPin;

static_assert(kPinsUnique, "FRONT pins must remain unique");
static_assert(kScannerI2cAddress != 0x29 && kFrontI2cAddress != 0x29 &&
                  kScannerI2cAddress != kFrontI2cAddress,
              "FRONT runtime I2C addresses must be distinct from 0x29");
static_assert(kScanMinDeg < kScanMaxDeg && kScanStepDeg > 0 &&
                  (kScanMaxDeg - kScanMinDeg) % kScanStepDeg == 0,
              "FRONT scan bounds must use a positive exact step");
static_assert(kServoMinAngleDeg <= kScanMinDeg &&
                  kServoMaxAngleDeg >= kScanMaxDeg,
              "FRONT scan bounds must fit inside the servo limits");
static_assert(kServoMinPulseUs < kServoMaxPulseUs,
              "FRONT servo pulse limits must be ordered");
static_assert(kDefaultSettleMs >= kMinimumSettleMs &&
                  kDefaultSettleMs <= kMaximumSettleMs,
              "FRONT default settle must stay inside its command limits");
static_assert(kNodeUartTxBufferBytes >= 176,
              "FRONT UART TX buffer must hold one complete node packet");

const fogsen::NodeConfig kNodeConfig = {
    "FRONT",                    // node_id
    "FRONT BOOT",               // boot_message
    "front",                    // fixed_a_json_key
    nullptr,                     // fixed_b_json_key
    false,                       // has_fixed_b
    kI2cSdaPin,                  // i2c_sda_pin
    kI2cSclPin,                  // i2c_scl_pin
    kNodeUartTxPin,              // uart_tx_pin
    kNodeUartRxPin,              // uart_rx_pin
    kServoPwmPin,                // servo_pwm_pin
    kScannerXshutPin,            // scanner_xshut_pin
    kFrontXshutPin,              // fixed_a_xshut_pin
    kUnusedXshutPin,             // fixed_b_xshut_pin
    kScannerI2cAddress,          // scanner_i2c_address
    kFrontI2cAddress,            // fixed_a_i2c_address
    kUnusedI2cAddress,           // fixed_b_i2c_address
    115200,                      // debug_baud
    115200,                      // node_uart_baud
    kNodeUartTxBufferBytes,       // node_uart_tx_buffer_bytes
    100000,                      // i2c_clock_hz
    30,                          // i2c_bus_timeout_ms
    80,                          // sensor_read_timeout_ms
    5000,                        // sensor_retry_ms
    50000,                       // xshut_reset_us
    20000,                       // xshut_boot_us
    5,                           // inter_sensor_guard_ms
    kScanMinDeg,                 // scan_min_deg
    kScanMaxDeg,                 // scan_max_deg
    kScanStepDeg,                // scan_step_deg
    0,                           // servo_center_deg
    kServoMinAngleDeg,           // servo_min_angle_deg
    kServoMaxAngleDeg,           // servo_max_angle_deg
    kServoMinPulseUs,            // servo_min_pulse_us
    kServoMaxPulseUs,            // servo_max_pulse_us
    50,                          // servo_frequency_hz
    14,                          // servo_resolution_bits
    kDefaultSettleMs,            // default_settle_ms
    kMinimumSettleMs,            // min_settle_ms
    kMaximumSettleMs,            // max_settle_ms
    100,                         // fixed_only_period_ms
    VL53L1X::Short,              // scanner_distance_mode
    20000,                       // scanner_timing_budget_us
    4000,                        // scanner_max_range_mm
    20000,                       // fixed_timing_budget_us
    2000,                        // fixed_max_range_mm
};

}  // namespace fogsen_front
