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

// LoRa SX1278 (VSPI bus)
constexpr int kLoraSck = 18;
constexpr int kLoraMiso = 19;
constexpr int kLoraMosi = 23;
constexpr int kLoraCs = 5;
constexpr int kLoraRst = 4;
constexpr int kLoraDio0 = 34;

// GPS NEO-6M
constexpr int kGpsRx = 35;
constexpr int kGpsTx = -1;  // Simplex NMEA receive; set to GPIO pin if UBX config transmission needed

// 5kg Load Cell with HX711 amplifier
constexpr int kLoadCellDout = 36;
constexpr int kLoadCellSck = 2;

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
static_assert(kLoraSck != kLoraMiso && kLoraSck != kLoraMosi &&
                  kLoraMiso != kLoraMosi,
              "LoRa SPI pins must be distinct");
static_assert(kLoraCs != kLoraRst && kLoraCs != kLoraDio0,
              "LoRa control pins must be distinct");
static_assert(kLoadCellDout != kLoadCellSck,
              "HX711 DOUT and SCK must be distinct");
static_assert(kLoadCellDout != kGpsRx && kLoadCellSck != kGpsRx,
              "HX711 must not conflict with GPS");
static_assert(kLoraCs != kI2cSda && kLoraCs != kI2cScl,
              "LoRa CS must not conflict with I2C");

}  // namespace pins
}  // namespace fogsen
