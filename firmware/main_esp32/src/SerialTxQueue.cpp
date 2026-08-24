#include "SerialTxQueue.h"

#include <string.h>

namespace fogsen {

SerialTxQueue::SerialTxQueue()
    : frames_{},
      head_(0),
      tail_(0),
      count_(0),
      droppedFrames_(0),
      sentFrames_(0) {}

bool SerialTxQueue::enqueueLine(const char* line, size_t length) {
  if (line == nullptr || length == 0 ||
      length + 1 >= config::kTelemetryLineCapacity ||
      count_ >= config::kTransmitQueueDepth) {
    ++droppedFrames_;
    return false;
  }

  Frame& frame = frames_[tail_];
  memcpy(frame.bytes, line, length);
  frame.bytes[length] = '\n';
  frame.length = static_cast<uint16_t>(length + 1);
  frame.offset = 0;
  tail_ = (tail_ + 1) % config::kTransmitQueueDepth;
  ++count_;
  return true;
}

void SerialTxQueue::poll(HardwareSerial& serial) {
  if (count_ == 0) {
    return;
  }

  const int writable = serial.availableForWrite();
  if (writable <= 0) {
    return;
  }

  Frame& frame = frames_[head_];
  const size_t remaining = frame.length - frame.offset;
  const size_t chunk = remaining < static_cast<size_t>(writable)
                           ? remaining
                           : static_cast<size_t>(writable);
  const size_t written = serial.write(
      reinterpret_cast<const uint8_t*>(frame.bytes + frame.offset), chunk);
  frame.offset = static_cast<uint16_t>(frame.offset + written);
  if (frame.offset < frame.length) {
    return;
  }

  head_ = (head_ + 1) % config::kTransmitQueueDepth;
  --count_;
  ++sentFrames_;
}

}  // namespace fogsen
