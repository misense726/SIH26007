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
    400000,                      // i2c_clock_hz
    30,                          // i2c_bus_timeout_ms
    80,                          // sensor_read_timeout_ms
    5000,                        // sensor_retry_ms
    2000,                        // xshut_reset_us
    2000,                        // xshut_boot_us
    5,                           // inter_sensor_guard_ms
    -80,                         // scan_min_deg
    80,                          // scan_max_deg
    10,                          // scan_step_deg
    0,                           // servo_center_deg
    -90,                         // servo_min_angle_deg
    90,                          // servo_max_angle_deg
    500,                         // servo_min_pulse_us
    2500,                        // servo_max_pulse_us
    50,                          // servo_frequency_hz
    14,                          // servo_resolution_bits
    90,                          // default_settle_ms
    20,                          // min_settle_ms
    120,                         // max_settle_ms
    100,                         // fixed_only_period_ms
    50000,                       // scanner_timing_budget_us
    4000,                        // scanner_max_range_mm
    20000,                       // fixed_timing_budget_us
    2000,                        // fixed_max_range_mm
};

}  // namespace fogsen_front
