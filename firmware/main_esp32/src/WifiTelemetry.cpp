#include "WifiTelemetry.h"

#include <WiFi.h>

#if __has_include("../wifi_secrets.h")
#include "../wifi_secrets.h"
#else
#include "../wifi_secrets.example.h"
#endif

namespace fogsen {

WifiTelemetry::WifiTelemetry()
    : queue_(nullptr),
      task_(nullptr),
      stationConnected_(false),
      backendConnected_(false),
      connectionGeneration_(0),
      droppedFrames_(0),
      sentFrames_(0) {}

bool WifiTelemetry::begin() {
  if (queue_ != nullptr || task_ != nullptr) {
    return true;
  }
  queue_ = xQueueCreate(config::kWifiTransmitQueueDepth, sizeof(Frame));
  if (queue_ == nullptr) {
    return false;
  }
  const BaseType_t created = xTaskCreatePinnedToCore(
      taskEntry, "fogsen-wifi", config::kWifiTaskStackBytes, this,
      config::kWifiTaskPriority, &task_, config::kWifiTaskCore);
  if (created != pdPASS) {
    vQueueDelete(queue_);
    queue_ = nullptr;
    task_ = nullptr;
    return false;
  }
  return true;
}

bool WifiTelemetry::enqueueLine(const char* line, size_t length) {
  if (queue_ == nullptr || line == nullptr || length == 0 ||
      length + 1 >= config::kTelemetryLineCapacity) {
    droppedFrames_.fetch_add(1);
    return false;
  }
  const uint32_t connectionGeneration = connectionGeneration_.load();
  if (!backendConnected_.load()) {
    droppedFrames_.fetch_add(1);
    return false;
  }
  Frame frame{};
  memcpy(frame.bytes, line, length);
  frame.bytes[length] = '\n';
  frame.length = static_cast<uint16_t>(length + 1);
  frame.connectionGeneration = connectionGeneration;
  if (xQueueSend(queue_, &frame, 0) != pdPASS) {
    droppedFrames_.fetch_add(1);
    return false;
  }
  return true;
}

void WifiTelemetry::taskEntry(void* context) {
  static_cast<WifiTelemetry*>(context)->run();
}

void WifiTelemetry::discardQueuedFrames() {
  if (queue_ == nullptr) {
    return;
  }
  Frame discarded{};
  uint32_t discardedCount = 0;
  while (xQueueReceive(queue_, &discarded, 0) == pdPASS) {
    ++discardedCount;
  }
  if (discardedCount > 0U) {
    droppedFrames_.fetch_add(discardedCount);
  }
}

void WifiTelemetry::run() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(wifi_secrets::kSsid, wifi_secrets::kPassword);

  WiFiClient client;
  uint32_t lastStationAttemptMs = millis();
  uint32_t lastBackendAttemptMs = 0;
  Frame frame{};

  for (;;) {
    const uint32_t nowMs = millis();
    stationConnected_ = WiFi.status() == WL_CONNECTED;
    if (!stationConnected_) {
      backendConnected_ = false;
      client.stop();
      discardQueuedFrames();
      if (nowMs - lastStationAttemptMs >= config::kWifiReconnectMs) {
        lastStationAttemptMs = nowMs;
        WiFi.disconnect(false, false);
        WiFi.begin(wifi_secrets::kSsid, wifi_secrets::kPassword);
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    if (!client.connected()) {
      backendConnected_ = false;
      discardQueuedFrames();
      if (nowMs - lastBackendAttemptMs >= config::kWifiReconnectMs) {
        lastBackendAttemptMs = nowMs;
        client.stop();
        if (client.connect(wifi_secrets::kBackendHost,
                           config::kWifiTelemetryPort, 1000)) {
          client.setNoDelay(true);
          discardQueuedFrames();
          connectionGeneration_.fetch_add(1);
          backendConnected_ = true;
        }
      }
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    backendConnected_ = true;
    if (xQueueReceive(queue_, &frame, pdMS_TO_TICKS(100)) != pdPASS) {
      continue;
    }
    if (frame.connectionGeneration != connectionGeneration_.load()) {
      droppedFrames_.fetch_add(1);
      continue;
    }
    const size_t written = client.write(
        reinterpret_cast<const uint8_t*>(frame.bytes), frame.length);
    if (written == frame.length) {
      sentFrames_.fetch_add(1);
    } else {
      droppedFrames_.fetch_add(1);
      backendConnected_ = false;
      client.stop();
      discardQueuedFrames();
    }
  }
}

}  // namespace fogsen
