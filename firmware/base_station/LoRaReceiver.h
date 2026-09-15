#pragma once

#include <stdint.h>
#include <stddef.h>
#include "BaseStationConfig.h"
#include "MultiNodeTracker.h"

namespace fogsen {
namespace basestation {

class LoRaReceiver {
 public:
  LoRaReceiver();

  bool begin();
  void poll(MultiNodeTracker& tracker, uint32_t nowMs);

  bool isOnline() const { return initialized_; }
  int16_t lastRssi() const { return lastRssi_; }
  float lastSnr() const { return lastSnr_; }
  uint32_t rxPacketCount() const { return rxPacketCount_; }
  uint32_t rxErrorCount() const { return rxErrorCount_; }
  long frequencyHz() const { return kLoraFrequencyHz; }

 private:
  void blinkRxLed();

  bool initialized_;
  int16_t lastRssi_;
  float lastSnr_;
  uint32_t rxPacketCount_;
  uint32_t rxErrorCount_;
  uint32_t lastInitAttemptMs_;
  uint8_t rxBuffer_[kLoRaPacketCapacity];
};

}  // namespace basestation
}  // namespace fogsen
