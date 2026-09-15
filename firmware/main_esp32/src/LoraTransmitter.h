#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <stdint.h>
#include "LoraPacket.h"

namespace fogsen {

enum class LoraStatus : uint8_t {
  kOffline = 0,
  kInitializing = 1,
  kHealthy = 2,
  kFault = 3
};

class LoraTransmitter {
 public:
  LoraTransmitter();

  bool begin(uint32_t nowMs);
  bool sendTelemetry(const LoraTelemetryPacket& packet, uint32_t nowMs);

  LoraStatus status() const { return status_; }
  uint32_t txCount() const { return txCount_; }
  uint32_t txFailCount() const { return txFailCount_; }
  uint32_t lastTxMs() const { return lastTxMs_; }

 private:
  LoraStatus status_;
  uint32_t txCount_;
  uint32_t txFailCount_;
  uint32_t lastTxMs_;
  SPIClass vspi_;
};

const char* loraStatusName(LoraStatus status);

}  // namespace fogsen
