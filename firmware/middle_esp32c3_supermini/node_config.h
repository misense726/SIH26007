#pragma once

#include "MiddleFixedNode.h"

namespace fogsen_middle {

// Common ESP32-C3 Super Mini pin labels are raw GPIO numbers.
constexpr uint8_t kLeftXshutPin = 0;
constexpr uint8_t kRightXshutPin = 1;
constexpr uint8_t kI2cSdaPin = 4;
constexpr uint8_t kI2cSclPin = 5;
constexpr uint8_t kNodeUartRxPin = 20;
constexpr uint8_t kNodeUartTxPin = 21;

constexpr uint8_t kLeftI2cAddress = 0x31;
constexpr uint8_t kRightI2cAddress = 0x32;

static_assert(kLeftXshutPin != kRightXshutPin,
              "Each middle ToF needs its own XSHUT GPIO");
static_assert(kI2cSdaPin != kI2cSclPin, "SDA and SCL must differ");
static_assert(kNodeUartRxPin != kNodeUartTxPin, "UART RX and TX must differ");

const fogsen::MiddleNodeConfig kNodeConfig = {
    "MIDDLE",                  // node_id
    "MIDDLE BOOT",             // boot_message
    "left",                    // fixed_a_json_key
    "right",                   // fixed_b_json_key
    kI2cSdaPin,                 // i2c_sda_pin
    kI2cSclPin,                 // i2c_scl_pin
    kNodeUartTxPin,             // uart_tx_pin
    kNodeUartRxPin,             // uart_rx_pin
    kLeftXshutPin,              // fixed_a_xshut_pin
    kRightXshutPin,             // fixed_b_xshut_pin
    kLeftI2cAddress,            // fixed_a_i2c_address
    kRightI2cAddress,           // fixed_b_i2c_address
    115200,                     // debug_baud
    115200,                     // node_uart_baud
    400000,                     // i2c_clock_hz
    30,                         // i2c_bus_timeout_ms
    80,                         // sensor_read_timeout_ms
    5000,                       // sensor_retry_ms
    10000,                      // xshut_reset_us
    10000,                      // xshut_boot_us
    5,                          // inter_sensor_guard_ms
    100,                        // sample_period_ms
    20000,                      // fixed_timing_budget_us
    2000,                       // fixed_max_range_mm
};

}  // namespace fogsen_middle
