#pragma once

#include <Arduino.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include "FirmwareConfig.h"

namespace fogsen {

class WifiTelemetry {
 public:
  WifiTelemetry();

  bool begin();
  bool enqueueLine(const char* line, size_t length);

  bool stationConnected() const { return stationConnected_.load(); }
  bool backendConnected() const { return backendConnected_.load(); }
  uint32_t droppedFrames() const { return droppedFrames_.load(); }
  uint32_t sentFrames() const { return sentFrames_.load(); }

 private:
  struct Frame {
    char bytes[config::kTelemetryLineCapacity];
    uint16_t length;
    uint32_t connectionGeneration;
  };

  static void taskEntry(void* context);
  void discardQueuedFrames();
  void run();

  QueueHandle_t queue_;
  TaskHandle_t task_;
  std::atomic<bool> stationConnected_;
  std::atomic<bool> backendConnected_;
  std::atomic<uint32_t> connectionGeneration_;
  std::atomic<uint32_t> droppedFrames_;
  std::atomic<uint32_t> sentFrames_;
};

}  // namespace fogsen
