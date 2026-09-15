#pragma once

#include <stddef.h>
#include <stdint.h>
#include "BaseStationConfig.h"
#include "MultiNodeTracker.h"
#include "LoRaReceiver.h"

namespace fogsen {
namespace basestation {

class TelemetryFormatter {
 public:
  TelemetryFormatter();

  // Serializes the full fogsen.main.v1 wire packet with GPS, LoadCell, and LoRa fields into outBuffer.
  // Returns number of bytes written, or 0 on overflow.
  size_t formatTelemetry(const MultiNodeTracker& tracker,
                         const LoRaReceiver& lora,
                         uint32_t nowMs,
                         uint32_t sequence,
                         char* outBuffer,
                         size_t maxCapacity);

  // Serializes a command reply in exact fogsen.main.v1 wire format
  size_t formatCommandReply(const char* cmd,
                            bool ok,
                            const char* reason,
                            uint32_t nowMs,
                            char* outBuffer,
                            size_t maxCapacity);

  // Serializes a boot event
  size_t formatBootEvent(uint32_t nowMs,
                         char* outBuffer,
                         size_t maxCapacity);

  uint32_t jsonOverflowDrops() const { return overflowDrops_; }

 private:
  uint32_t overflowDrops_;
};

}  // namespace basestation
}  // namespace fogsen
