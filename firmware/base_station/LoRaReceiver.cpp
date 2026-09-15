#include "LoRaReceiver.h"
#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>

namespace fogsen {
namespace basestation {

LoRaReceiver::LoRaReceiver()
    : initialized_(false),
      lastRssi_(0),
      lastSnr_(0.0F),
      rxPacketCount_(0),
      rxErrorCount_(0),
      lastInitAttemptMs_(0),
      rxBuffer_{} {}

bool LoRaReceiver::begin() {
  pinMode(kLedPin, OUTPUT);
  digitalWrite(kLedPin, kLedActiveHigh ? LOW : HIGH);

#if defined(ESP32)
  SPI.begin(kLoraSckPin, kLoraMisoPin, kLoraMosiPin, kLoraCsPin);
#elif defined(ESP8266)
  SPI.begin();
#endif

  LoRa.setPins(kLoraCsPin, kLoraResetPin, kLoraDio0Pin);

  if (!LoRa.begin(kLoraFrequencyHz)) {
    initialized_ = false;
    return false;
  }

  LoRa.setSpreadingFactor(kLoraSpreadingFactor);
  LoRa.setSignalBandwidth(kLoraSignalBandwidth);
  LoRa.setCodingRate4(kLoraCodingRate4);
  LoRa.setSyncWord(kLoraSyncWord);

  if (kLoraEnableCrc) {
    LoRa.enableCrc();
  } else {
    LoRa.disableCrc();
  }

  initialized_ = true;
  return true;
}

void LoRaReceiver::blinkRxLed() {
  const bool onLevel = kLedActiveHigh ? HIGH : LOW;
  const bool offLevel = kLedActiveHigh ? LOW : HIGH;
  digitalWrite(kLedPin, onLevel);
  delayMicroseconds(200);
  digitalWrite(kLedPin, offLevel);
}

void LoRaReceiver::poll(MultiNodeTracker& tracker, uint32_t nowMs) {
  if (!initialized_) {
    if (nowMs - lastInitAttemptMs_ >= 5000) {
      lastInitAttemptMs_ = nowMs;
      begin();
    }
    return;
  }

  const int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) {
    return;
  }

  size_t bytesRead = 0;
  while (LoRa.available() && bytesRead < (kLoRaPacketCapacity - 1)) {
    rxBuffer_[bytesRead++] = static_cast<uint8_t>(LoRa.read());
  }
  rxBuffer_[bytesRead] = '\0';

  lastRssi_ = static_cast<int16_t>(LoRa.packetRssi());
  lastSnr_ = LoRa.packetSnr();
  ++rxPacketCount_;

  bool success = false;
  if (bytesRead == sizeof(LoRaBinaryPayload) && rxBuffer_[0] == kBinaryMagicByte) {
    success = tracker.processBinaryPacket(rxBuffer_, bytesRead, lastRssi_, lastSnr_, nowMs);
  } else {
    success = tracker.processJsonPacket(
        reinterpret_cast<const char*>(rxBuffer_), bytesRead, lastRssi_, lastSnr_, nowMs);
  }

  if (!success) {
    ++rxErrorCount_;
  } else {
    blinkRxLed();
  }
}

}  // namespace basestation
}  // namespace fogsen
