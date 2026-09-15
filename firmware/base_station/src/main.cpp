#include <Arduino.h>
#include <ArduinoJson.h>
#include <LoRa.h>
#include <SPI.h>
#include <math.h>
#include <string.h>

#include "BaseStationConfig.h"
#include "LoraPacket.h"
#include "NodeTracker.h"

namespace fogsen {
namespace base_station {

NodeTracker nodeTracker;
StaticJsonDocument<kJsonCapacity> telemetryDoc;
char jsonBuffer[kLineCapacity];
uint32_t ledOffMs = 0;
bool ledActive = false;

float compactFloat(float value, float scale) {
  return roundf(value * scale) / scale;
}

void triggerLed(uint32_t nowMs, uint32_t durationMs = 15) {
#if defined(ESP8266)
  digitalWrite(kStatusLed, LOW);  // Active low on ESP8266
#else
  digitalWrite(kStatusLed, HIGH); // Active high on ESP32
#endif
  ledActive = true;
  ledOffMs = nowMs + durationMs;
}

void updateLed(uint32_t nowMs) {
  if (ledActive && static_cast<int32_t>(nowMs - ledOffMs) >= 0) {
#if defined(ESP8266)
    digitalWrite(kStatusLed, HIGH); // Off
#else
    digitalWrite(kStatusLed, LOW);  // Off
#endif
    ledActive = false;
  }
}

const char* estopStateName(uint8_t state) {
  switch (state) {
    case 0: return "SAFE";
    case 1: return "WARNING";
    case 2: return "CRITICAL";
    case 3: return "EMERGENCY_STOP";
    case 4: return "SENSOR_FAULT";
    default: return "WARNING";
  }
}

const char* weightStatusName(uint8_t status) {
  switch (status) {
    case 0: return "OFFLINE";
    case 1: return "INITIALIZING";
    case 2: return "HEALTHY";
    case 3: return "STALE";
    case 4: return "FAULT";
    default: return "UNKNOWN";
  }
}

const char* gpsFixName(uint8_t fix) {
  switch (fix) {
    case 0: return "NO_HARDWARE";
    case 1: return "SEARCHING";
    case 2: return "FIX_2D";
    case 3: return "FIX_3D";
    case 4: return "STALE";
    default: return "NO_HARDWARE";
  }
}

void publishNodeTelemetry(const TrackedNodeState& node, uint32_t nowMs) {
  telemetryDoc.clear();
  const LoraTelemetryPacket& pkt = node.latestPacket;

  telemetryDoc["type"] = "telemetry";
  telemetryDoc["schema"] = kTelemetrySchema;
  telemetryDoc["fw"] = kFirmwareVersion;
  telemetryDoc["mode"] = kDataMode;
  telemetryDoc["seq"] = pkt.sequence;
  telemetryDoc["ms"] = nowMs;
  telemetryDoc["vehicle_id"] = node.vehicleId;
  telemetryDoc["node_id"] = node.nodeId;

  // Front ToF
  JsonObject front = telemetryDoc.createNestedObject("front");
  front["state"] = "HEALTHY";
  front["age"] = 0;
  front["seq"] = pkt.sequence;
  front["node_ms"] = pkt.timestampMs;
  front["a"] = pkt.anglesDeg[0];
  front["scan"] = pkt.rangesMm[0];
  front["scan_age"] = 0;
  front["front"] = pkt.rangesMm[1];
  front["front_age"] = 0;
  front["ok"] = 11;
  front["drop"] = node.dropCount;
  front["ooo"] = 0;
  front["bad"] = node.crcErrorCount;
  front["reboot"] = 0;

  // Rear ToF
  JsonObject rear = telemetryDoc.createNestedObject("rear");
  rear["state"] = "HEALTHY";
  rear["age"] = 0;
  rear["seq"] = pkt.sequence;
  rear["node_ms"] = pkt.timestampMs;
  rear["a"] = pkt.anglesDeg[1];
  rear["scan"] = pkt.rangesMm[2];
  rear["scan_age"] = 0;
  rear["left"] = pkt.rangesMm[3];
  rear["left_age"] = 0;
  rear["right"] = pkt.rangesMm[4];
  rear["right_age"] = 0;
  rear["ok"] = 15;
  rear["drop"] = node.dropCount;
  rear["ooo"] = 0;
  rear["bad"] = node.crcErrorCount;
  rear["reboot"] = 0;

  // IMU
  JsonObject imu = telemetryDoc.createNestedObject("imu");
  imu["state"] = "HEALTHY";
  imu["age"] = 0;
  imu["ax"] = compactFloat(static_cast<float>(pkt.accelMg[0]) * 0.00980665F, 1000.0F);
  imu["ay"] = compactFloat(static_cast<float>(pkt.accelMg[1]) * 0.00980665F, 1000.0F);
  imu["az"] = compactFloat(static_cast<float>(pkt.accelMg[2]) * 0.00980665F, 1000.0F);
  imu["gx"] = compactFloat(static_cast<float>(pkt.gyroDpsX10[0]) * 0.1F, 100.0F);
  imu["gy"] = compactFloat(static_cast<float>(pkt.gyroDpsX10[1]) * 0.1F, 100.0F);
  imu["gz"] = compactFloat(static_cast<float>(pkt.gyroDpsX10[2]) * 0.1F, 100.0F);
  imu["err"] = 0;

  // Environment
  JsonObject env = telemetryDoc.createNestedObject("env");
  env["state"] = "HEALTHY";
  env["age"] = 0;
  env["temp"] = compactFloat(static_cast<float>(pkt.tempCc) * 0.01F, 100.0F);
  env["pressure"] = compactFloat(static_cast<float>(pkt.pressureDpa) * 0.1F, 100.0F);
  env["rel_alt"] = compactFloat(static_cast<float>(pkt.relAltDm) * 0.1F, 100.0F);
  env["baseline"] = 1;
  env["err"] = 0;

  // Wheel
  JsonObject wheel = telemetryDoc.createNestedObject("wheel");
  wheel["enabled"] = 0;
  wheel["l"] = 0;
  wheel["r"] = 0;
  wheel["ls"] = 0;
  wheel["rs"] = 0;
  wheel["speed"] = compactFloat(static_cast<float>(pkt.speedCms) * 0.01F, 100.0F);

  // E-Stop
  JsonObject estop = telemetryDoc.createNestedObject("estop");
  estop["state"] = estopStateName(pkt.estopState);
  estop["reason"] = (pkt.estopState == 0) ? "CLEAR" : "OBSTACLE";
  estop["direction"] = "FORWARD";
  estop["coverage"] = 1;
  estop["output_enabled"] = 0;
  estop["cut_requested"] = pkt.estopCut;
  estop["cut"] = pkt.estopCut;
  estop["latched"] = 0;
  if (pkt.nearestMm >= 0) {
    estop["nearest"] = compactFloat(static_cast<float>(pkt.nearestMm) * 0.001F, 1000.0F);
  } else {
    estop["nearest"] = nullptr;
  }
  estop["warn"] = 0.75;
  estop["critical"] = 0.45;
  estop["stop"] = 0.22;
  estop["latched_ms"] = 0;

  // GPS
  JsonObject gps = telemetryDoc.createNestedObject("gps");
  gps["state"] = gpsFixName(pkt.gpsFix);
  gps["fix"] = (pkt.gpsFix >= 2) ? 1 : 0;
  gps["sats"] = pkt.satellites;
  if (pkt.gpsFix >= 2) {
    gps["lat"] = compactFloat(static_cast<float>(pkt.lat1e7) * 1e-7F, 1000000.0F);
    gps["lon"] = compactFloat(static_cast<float>(pkt.lon1e7) * 1e-7F, 1000000.0F);
    gps["alt"] = static_cast<float>(pkt.altM);
    gps["speed"] = compactFloat(static_cast<float>(pkt.speedCms) * 0.01F, 100.0F);
    gps["course"] = compactFloat(static_cast<float>(pkt.courseCdeg) * 0.01F, 100.0F);
  } else {
    gps["lat"] = nullptr;
    gps["lon"] = nullptr;
    gps["alt"] = nullptr;
    gps["speed"] = nullptr;
    gps["course"] = nullptr;
  }

  // Load Cell
  JsonObject lc = telemetryDoc.createNestedObject("loadcell");
  lc["state"] = weightStatusName(pkt.weightStatus);
  if (pkt.weightStatus == 2) {
    lc["weight_g"] = pkt.weightGrams;
    lc["weight_kg"] = compactFloat(static_cast<float>(pkt.weightGrams) * 0.001F, 100.0F);
    lc["ok"] = 1;
  } else {
    lc["weight_g"] = nullptr;
    lc["weight_kg"] = nullptr;
    lc["ok"] = 0;
  }

  // LoRa Link Diagnostics
  JsonObject lora = telemetryDoc.createNestedObject("lora");
  lora["node_id"] = node.nodeId;
  lora["rssi"] = node.lastRssi;
  lora["snr"] = compactFloat(node.lastSnr, 10.0F);
  lora["rx_count"] = node.rxCount;
  lora["drop_count"] = node.dropCount;
  lora["rate_hz"] = compactFloat(node.packetRateHz, 10.0F);

  // System status
  JsonObject system = telemetryDoc.createNestedObject("system");
  system["tx_drop"] = 0;
  system["json_drop"] = 0;
  system["cmd_overflow"] = 0;

  serializeJson(telemetryDoc, jsonBuffer, sizeof(jsonBuffer));
  Serial.println(jsonBuffer);
}

void processIncomingRadio(uint32_t nowMs) {
  const int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) {
    return;
  }

  if (packetSize != static_cast<int>(sizeof(LoraTelemetryPacket))) {
    while (LoRa.available()) {
      LoRa.read();
    }
    return;
  }

  LoraTelemetryPacket packet;
  const size_t bytesRead = LoRa.readBytes(reinterpret_cast<char*>(&packet), sizeof(packet));
  if (bytesRead != sizeof(packet) || packet.magic != kLoraPacketMagic) {
    return;
  }

  if (!verifyPacketCrc(packet)) {
    nodeTracker.recordCrcError(packet.nodeId);
    return;
  }

  const int16_t rssi = static_cast<int16_t>(LoRa.packetRssi());
  const float snr = LoRa.packetSnr();

  if (nodeTracker.ingestPacket(packet, rssi, snr, nowMs)) {
    triggerLed(nowMs);
    const TrackedNodeState* node = nodeTracker.getNode(packet.nodeId);
    if (node != nullptr) {
      publishNodeTelemetry(*node, nowMs);
    }
  }
}

void processUsbCommands(uint32_t nowMs) {
  if (!Serial.available()) {
    return;
  }

  String line = Serial.readStringUntil('\n');
  line.trim();
  line.toUpperCase();

  if (line == "STATUS" || line == "PING") {
    StaticJsonDocument<512> doc;
    doc["type"] = "command_reply";
    doc["schema"] = kTelemetrySchema;
    doc["ms"] = nowMs;
    doc["cmd"] = line;
    doc["ok"] = 1;
    doc["role"] = "BASE_STATION";

    JsonArray nodes = doc.createNestedArray("nodes");
    for (uint8_t i = 1; i <= kMaxTrackedNodes; ++i) {
      const TrackedNodeState* node = nodeTracker.getNode(i);
      if (node != nullptr) {
        JsonObject item = nodes.createNestedObject();
        item["id"] = node->nodeId;
        item["vehicle"] = node->vehicleId;
        item["active"] = node->active ? 1 : 0;
        item["fresh"] = nodeTracker.isFresh(i, nowMs) ? 1 : 0;
        item["rx"] = node->rxCount;
        item["drop"] = node->dropCount;
        item["rssi"] = node->lastRssi;
        item["rate_hz"] = compactFloat(node->packetRateHz, 10.0F);
      }
    }
    serializeJson(doc, jsonBuffer, sizeof(jsonBuffer));
    Serial.println(jsonBuffer);
  }
}

void printBootEvent() {
  StaticJsonDocument<256> boot;
  boot["type"] = "boot";
  boot["schema"] = kTelemetrySchema;
  boot["fw"] = kFirmwareVersion;
  boot["mode"] = kDataMode;
  boot["ms"] = millis();
  boot["role"] = "BASE_STATION";
#if defined(ESP32)
  boot["arch"] = "ESP32";
#elif defined(ESP8266)
  boot["arch"] = "ESP8266";
#endif
  serializeJson(boot, jsonBuffer, sizeof(jsonBuffer));
  Serial.println(jsonBuffer);
}

}  // namespace base_station
}  // namespace fogsen

void setup() {
  using namespace fogsen::base_station;

  pinMode(kStatusLed, OUTPUT);
#if defined(ESP8266)
  digitalWrite(kStatusLed, HIGH); // Off on active-low ESP8266
#else
  digitalWrite(kStatusLed, LOW);  // Off on ESP32
#endif

  Serial.begin(kUsbSerialBaud);

#if defined(ESP32)
  SPI.begin(kLoraSck, kLoraMiso, kLoraMosi, kLoraCs);
  LoRa.setSPI(SPI);
#elif defined(ESP8266)
  SPI.begin();
#endif

  LoRa.setPins(kLoraCs, kLoraRst, kLoraDio0);
  if (!LoRa.begin(kLoraFrequency)) {
    Serial.println(F("{\"type\":\"boot_error\",\"reason\":\"LORA_INIT_FAILED\"}"));
    while (true) {
      delay(500);
#if defined(ESP8266)
      digitalWrite(kStatusLed, !digitalRead(kStatusLed));
#else
      digitalWrite(kStatusLed, !digitalRead(kStatusLed));
#endif
    }
  }

  LoRa.setSignalBandwidth(kLoraBandwidth);
  LoRa.setSpreadingFactor(kLoraSpreadingFactor);
  LoRa.setCodingRate4(kLoraCodingRate);
  LoRa.setSyncWord(kLoraSyncWord);
  LoRa.setPreambleLength(kLoraPreambleLength);
  LoRa.enableCrc();

  const uint32_t nowMs = millis();
  nodeTracker.begin(nowMs);
  triggerLed(nowMs, 200);
  printBootEvent();
}

void loop() {
  using namespace fogsen::base_station;

  const uint32_t nowMs = millis();
  processIncomingRadio(nowMs);
  processUsbCommands(nowMs);
  updateLed(nowMs);
  nodeTracker.updateRates(nowMs);

  yield();
}
