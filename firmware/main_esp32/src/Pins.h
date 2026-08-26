#pragma once

namespace fogsen {
namespace pins {

constexpr int kFrontUartRx = 16;
constexpr int kFrontUartTx = 17;
constexpr int kMiddleUartRx = 26;
constexpr int kMiddleUartTx = 27;

constexpr int kI2cSda = 21;
constexpr int kI2cScl = 22;
constexpr int kRearScannerXshut = 13;
constexpr int kRearServoPwm = 14;

constexpr int kHallLeft = 32;
constexpr int kHallRight = 33;
constexpr int kMotorCutRelay = 25;

static_assert(kFrontUartRx != kFrontUartTx, "FRONT UART RX and TX must differ");
static_assert(kMiddleUartRx != kMiddleUartTx,
              "MIDDLE UART RX and TX must differ");
static_assert(kHallLeft != kHallRight, "Hall inputs must use separate pins");
static_assert(kMotorCutRelay != kI2cSda && kMotorCutRelay != kI2cScl,
              "Relay output must not share the I2C bus");
static_assert(kMotorCutRelay != kFrontUartRx &&
                  kMotorCutRelay != kFrontUartTx &&
                  kMotorCutRelay != kMiddleUartRx &&
                  kMotorCutRelay != kMiddleUartTx,
              "Relay output must not share a UART pin");
static_assert(kRearScannerXshut != kRearServoPwm,
              "Rear scanner XSHUT and servo PWM must differ");
static_assert(kRearScannerXshut != kI2cSda &&
                  kRearScannerXshut != kI2cScl &&
                  kRearServoPwm != kI2cSda && kRearServoPwm != kI2cScl,
              "Rear scanner control pins must not share the I2C bus");

}  // namespace pins
}  // namespace fogsen
