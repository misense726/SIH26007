#pragma once

namespace fogsen {
namespace pins {

constexpr int kFrontUartRx = 16;
constexpr int kFrontUartTx = 17;
constexpr int kRearUartRx = 26;
constexpr int kRearUartTx = 27;

constexpr int kI2cSda = 21;
constexpr int kI2cScl = 22;

constexpr int kHallLeft = 32;
constexpr int kHallRight = 33;
constexpr int kMotorCutRelay = 25;

static_assert(kFrontUartRx != kFrontUartTx, "FRONT UART RX and TX must differ");
static_assert(kRearUartRx != kRearUartTx, "REAR UART RX and TX must differ");
static_assert(kHallLeft != kHallRight, "Hall inputs must use separate pins");
static_assert(kMotorCutRelay != kI2cSda && kMotorCutRelay != kI2cScl,
              "Relay output must not share the I2C bus");
static_assert(kMotorCutRelay != kFrontUartRx &&
                  kMotorCutRelay != kFrontUartTx &&
                  kMotorCutRelay != kRearUartRx &&
                  kMotorCutRelay != kRearUartTx,
              "Relay output must not share a UART pin");

}  // namespace pins
}  // namespace fogsen
