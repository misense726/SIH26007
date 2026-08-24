#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

#include "FirmwareConfig.h"

namespace fogsen {

class SerialTxQueue {
 public:
  SerialTxQueue();

  bool enqueueLine(const char* line, size_t length);
  void poll(HardwareSerial& serial);

  size_t queuedFrames() const { return count_; }
  uint32_t droppedFrames() const { return droppedFrames_; }
  uint32_t sentFrames() const { return sentFrames_; }

 private:
  struct Frame {
    char bytes[config::kTelemetryLineCapacity];
    uint16_t length;
    uint16_t offset;
  };

  Frame frames_[config::kTransmitQueueDepth];
  size_t head_;
  size_t tail_;
  size_t count_;
  uint32_t droppedFrames_;
  uint32_t sentFrames_;
};

}  // namespace fogsen
