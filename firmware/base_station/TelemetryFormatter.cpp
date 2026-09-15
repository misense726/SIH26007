#include "TelemetryFormatter.h"
#include <ArduinoJson.h>
#include <math.h>
#include <string.h>

namespace fogsen {
namespace basestation {

namespace {

float compactFloat(float value, float scale = 100.0F) {
  return roundf(value * scale) / scale;
}

double compactDouble(double value, double scale = 1000000.0) {
  return round(value * scale) / scale;
}

}  // namespace

TelemetryFormatter::TelemetryFormatter() : overflowDrops_(0) {}

size_t TelemetryFormatter::formatTelemetry(const MultiNodeTracker& tracker,
                                          const LoRaReceiver& lora,
                                          uint32_t nowMs,
                                          uint32_t sequence,
                                          char* outBuffer,
                                          size_t maxCapacity) {
  if (outBuffer == nullptr || maxCapacity == 0) {
    return 0;
  }

  StaticJsonDocument<kJsonDocCapacity> doc;

  doc["type"] = "telemetry";
  doc["schema"] = kTelemetrySchema;
  doc["fw"] = kFirmwareVersion;
  doc["mode"] = kDataMode;
  doc["seq"] = sequence;
  doc["ms"] = nowMs;

  const NodeState& n1 = tracker.node1();
  const NodeState& n2 = tracker.node2();

  // --------------------------------------------------------------------------
  // 1. FRONT Node Telemetry (Node 1)
  // --------------------------------------------------------------------------
  JsonObject front = doc.createNestedObject("front");
  front["state"] = n1.state;
  if (n1.hasSample) {
    front["age"] = nowMs - n1.lastRxMs;
    front["seq"] = n1.lastSeq;
    front["node_ms"] = n1.nodeMs;
    front["a"] = n1.angleDeg;
    front["scan"] = n1.scanMm;
    front["scan_age"] = nowMs - n1.lastRxMs;
    front["front"] = n1.aux1Mm;
    front["front_age"] = nowMs - n1.lastRxMs;
    front["ok"] = n1.healthMask;
  } else {
    front["age"] = nullptr;
    front["seq"] = nullptr;
    front["node_ms"] = nullptr;
    front["a"] = nullptr;
    front["scan"] = -1;
    front["scan_age"] = nullptr;
    front["front"] = -1;
    front["front_age"] = nullptr;
    front["ok"] = 0;
  }
  front["drop"] = n1.dropCount;
  front["ooo"] = n1.outOfOrderCount;
  front["bad"] = 0;
  front["reboot"] = n1.rebootCount;

  // --------------------------------------------------------------------------
  // 2. REAR Node Telemetry (Node 2)
  // --------------------------------------------------------------------------
  JsonObject rear = doc.createNestedObject("rear");
  rear["state"] = n2.state;
  if (n2.hasSample) {
    rear["age"] = nowMs - n2.lastRxMs;
    rear["seq"] = n2.lastSeq;
    rear["node_ms"] = n2.nodeMs;
    rear["a"] = n2.angleDeg;
    rear["scan"] = n2.scanMm;
    rear["scan_age"] = nowMs - n2.lastRxMs;
    rear["left"] = n2.aux1Mm;
    rear["left_age"] = nowMs - n2.lastRxMs;
    rear["right"] = n2.aux2Mm;
    rear["right_age"] = nowMs - n2.lastRxMs;
    rear["ok"] = n2.healthMask;
  } else {
    rear["age"] = nullptr;
    rear["seq"] = nullptr;
    rear["node_ms"] = nullptr;
    rear["a"] = nullptr;
    rear["scan"] = -1;
    rear["scan_age"] = nullptr;
    rear["left"] = -1;
    rear["left_age"] = nullptr;
    rear["right"] = -1;
    rear["right_age"] = nullptr;
    rear["ok"] = 0;
  }
  rear["drop"] = n2.dropCount;
  rear["ooo"] = n2.outOfOrderCount;
  rear["bad"] = 0;
  rear["reboot"] = n2.rebootCount;

  // --------------------------------------------------------------------------
  // 3. IMU Telemetry (Aggregate from nodes)
  // --------------------------------------------------------------------------
  const NodeState* imuSource = n1.hasImu ? &n1 : (n2.hasImu ? &n2 : nullptr);
  JsonObject imu = doc.createNestedObject("imu");
  if (imuSource != nullptr) {
    imu["state"] = imuSource->state;
    imu["age"] = nowMs - imuSource->lastRxMs;
    imu["ax"] = compactFloat(imuSource->ax, 1000.0F);
    imu["ay"] = compactFloat(imuSource->ay, 1000.0F);
    imu["az"] = compactFloat(imuSource->az, 1000.0F);
    imu["gx"] = compactFloat(imuSource->gx, 100.0F);
    imu["gy"] = compactFloat(imuSource->gy, 100.0F);
    imu["gz"] = compactFloat(imuSource->gz, 100.0F);
    imu["heading"] = compactFloat(imuSource->heading, 10.0F);
  } else {
    imu["state"] = "OFFLINE";
    imu["age"] = nullptr;
    imu["ax"] = nullptr;
    imu["ay"] = nullptr;
    imu["az"] = nullptr;
    imu["gx"] = nullptr;
    imu["gy"] = nullptr;
    imu["gz"] = nullptr;
    imu["heading"] = nullptr;
  }
  imu["err"] = 0;

  // --------------------------------------------------------------------------
  // 4. Environment Telemetry (Aggregate from nodes)
  // --------------------------------------------------------------------------
  const NodeState* envSource = n1.hasEnv ? &n1 : (n2.hasEnv ? &n2 : nullptr);
  JsonObject env = doc.createNestedObject("env");
  if (envSource != nullptr) {
    env["state"] = envSource->state;
    env["age"] = nowMs - envSource->lastRxMs;
    env["temp"] = compactFloat(envSource->tempC, 10.0F);
    env["pressure"] = compactFloat(envSource->pressureHpa, 10.0F);
    env["rel_alt"] = compactFloat(envSource->relAltM, 10.0F);
    env["baseline"] = 1;
  } else {
    env["state"] = "OFFLINE";
    env["age"] = nullptr;
    env["temp"] = nullptr;
    env["pressure"] = nullptr;
    env["rel_alt"] = nullptr;
    env["baseline"] = 0;
  }
  env["err"] = 0;

  // --------------------------------------------------------------------------
  // 5. Wheel Telemetry
  // --------------------------------------------------------------------------
  JsonObject wheel = doc.createNestedObject("wheel");
  wheel["enabled"] = 0;
  wheel["l"] = 0;
  wheel["r"] = 0;
  wheel["ls"] = 0.0F;
  wheel["rs"] = 0.0F;
  // If GPS speed is available, report it in speed field
  const NodeState* gpsSource = n1.hasGps ? &n1 : (n2.hasGps ? &n2 : nullptr);
  wheel["speed"] = (gpsSource != nullptr && gpsSource->gpsValid) ? compactFloat(gpsSource->gpsSpeed, 100.0F) : 0.0F;

  // --------------------------------------------------------------------------
  // 6. Emergency Stop Safety State
  // --------------------------------------------------------------------------
  JsonObject estop = doc.createNestedObject("estop");
  bool hasValidRange = false;
  const float nearestM = tracker.calculateNearestForwardM(hasValidRange);
  const bool coverage = tracker.isForwardCoverageSufficient();

  const char* stopState = "SAFE";
  const char* stopReason = "CLEAR";
  bool cutRequested = false;

  if (hasValidRange && nearestM <= kEmergencyDistanceM) {
    stopState = "EMERGENCY_STOP";
    stopReason = "OBSTACLE_STOP";
    cutRequested = true;
  } else if (hasValidRange && nearestM <= kCriticalDistanceM) {
    stopState = "CRITICAL";
    stopReason = "OBSTACLE_CRITICAL";
  } else if (hasValidRange && nearestM <= kWarningDistanceM) {
    stopState = "WARNING";
    stopReason = "OBSTACLE_WARNING";
  } else if (!coverage) {
    stopState = "SAFE";
    stopReason = n1.hasSample ? "CLEAR" : "AWAITING_TELEMETRY";
  }

  estop["state"] = stopState;
  estop["reason"] = stopReason;
  estop["direction"] = "FORWARD";
  estop["coverage"] = coverage ? 1 : 0;
  estop["output_enabled"] = 0;
  estop["cut_requested"] = cutRequested ? 1 : 0;
  estop["cut"] = 0;
  estop["latched"] = 0;
  if (hasValidRange) {
    estop["nearest"] = compactFloat(nearestM, 1000.0F);
  } else {
    estop["nearest"] = nullptr;
  }
  estop["warn"] = compactFloat(kWarningDistanceM, 1000.0F);
  estop["critical"] = compactFloat(kCriticalDistanceM, 1000.0F);
  estop["stop"] = compactFloat(kEmergencyDistanceM, 1000.0F);
  estop["latched_ms"] = 0;

  // --------------------------------------------------------------------------
  // 7. NEW FIELD: GPS Telemetry
  // --------------------------------------------------------------------------
  JsonObject gps = doc.createNestedObject("gps");
  if (gpsSource != nullptr) {
    gps["state"] = gpsSource->gpsValid ? "HEALTHY" : "NO_FIX";
    gps["age"] = nowMs - gpsSource->lastRxMs;
    gps["fix"] = gpsSource->gpsValid ? 1 : 0;
    if (gpsSource->gpsValid) {
      gps["lat"] = compactDouble(gpsSource->gpsLat, 1000000.0);
      gps["lng"] = compactDouble(gpsSource->gpsLng, 1000000.0);
      gps["alt"] = compactFloat(gpsSource->gpsAlt, 10.0F);
      gps["speed"] = compactFloat(gpsSource->gpsSpeed, 100.0F);
      gps["heading"] = compactFloat(gpsSource->gpsHeading, 10.0F);
      gps["sats"] = gpsSource->gpsSats;
      gps["hdop"] = compactFloat(gpsSource->gpsHdop, 10.0F);
    } else {
      gps["lat"] = nullptr;
      gps["lng"] = nullptr;
      gps["alt"] = nullptr;
      gps["speed"] = nullptr;
      gps["heading"] = nullptr;
      gps["sats"] = gpsSource->gpsSats;
      gps["hdop"] = nullptr;
    }
  } else {
    gps["state"] = "OFFLINE";
    gps["age"] = nullptr;
    gps["fix"] = 0;
    gps["lat"] = nullptr;
    gps["lng"] = nullptr;
    gps["alt"] = nullptr;
    gps["speed"] = nullptr;
    gps["heading"] = nullptr;
    gps["sats"] = 0;
    gps["hdop"] = nullptr;
  }

  // --------------------------------------------------------------------------
  // 8. NEW FIELD: LoadCell Telemetry
  // --------------------------------------------------------------------------
  const NodeState* loadSource = n1.hasLoadCell ? &n1 : (n2.hasLoadCell ? &n2 : nullptr);
  JsonObject load = doc.createNestedObject("loadcell");
  if (loadSource != nullptr) {
    load["state"] = loadSource->overload ? "OVERLOAD" : "HEALTHY";
    load["age"] = nowMs - loadSource->lastRxMs;
    load["weight"] = compactFloat(loadSource->weightKg, 10.0F);
    load["raw"] = loadSource->rawLoad;
    load["unit"] = "kg";
    load["overload"] = loadSource->overload ? 1 : 0;
    load["calibrated"] = loadSource->calibrated ? 1 : 0;
  } else {
    load["state"] = "OFFLINE";
    load["age"] = nullptr;
    load["weight"] = nullptr;
    load["raw"] = nullptr;
    load["unit"] = "kg";
    load["overload"] = 0;
    load["calibrated"] = 0;
  }

  // --------------------------------------------------------------------------
  // 9. NEW FIELD: LoRa Link Telemetry
  // --------------------------------------------------------------------------
  JsonObject loraObj = doc.createNestedObject("lora");
  loraObj["state"] = lora.isOnline() ? "ONLINE" : "ERROR";
  loraObj["freq_mhz"] = compactFloat(static_cast<float>(lora.frequencyHz()) / 1e6F, 10.0F);
  if (lora.rxPacketCount() > 0) {
    loraObj["last_rssi"] = lora.lastRssi();
    loraObj["last_snr"] = compactFloat(lora.lastSnr(), 10.0F);
  } else {
    loraObj["last_rssi"] = nullptr;
    loraObj["last_snr"] = nullptr;
  }
  loraObj["rx_pkts"] = lora.rxPacketCount();
  loraObj["rx_drops"] = tracker.totalDrops();
  loraObj["crc_err"] = lora.rxErrorCount();

  // --------------------------------------------------------------------------
  // 10. Multi-Node Tracking Details (node1 and node2)
  // --------------------------------------------------------------------------
  JsonObject nodesObj = doc.createNestedObject("nodes");

  JsonObject nd1 = nodesObj.createNestedObject("node1");
  nd1["state"] = n1.state;
  nd1["id"] = 1;
  nd1["role"] = n1.role;
  if (n1.hasSample) {
    nd1["seq"] = n1.lastSeq;
    nd1["age"] = nowMs - n1.lastRxMs;
    nd1["node_ms"] = n1.nodeMs;
    nd1["rssi"] = n1.lastRssi;
    nd1["snr"] = compactFloat(n1.lastSnr, 10.0F);
    nd1["pkt_count"] = n1.packetCount;
    nd1["drop_count"] = n1.dropCount;
    nd1["last_rx_ms"] = n1.lastRxMs;
  } else {
    nd1["seq"] = nullptr;
    nd1["age"] = nullptr;
    nd1["node_ms"] = nullptr;
    nd1["rssi"] = nullptr;
    nd1["snr"] = nullptr;
    nd1["pkt_count"] = 0;
    nd1["drop_count"] = 0;
    nd1["last_rx_ms"] = nullptr;
  }

  JsonObject nd2 = nodesObj.createNestedObject("node2");
  nd2["state"] = n2.state;
  nd2["id"] = 2;
  nd2["role"] = n2.role;
  if (n2.hasSample) {
    nd2["seq"] = n2.lastSeq;
    nd2["age"] = nowMs - n2.lastRxMs;
    nd2["node_ms"] = n2.nodeMs;
    nd2["rssi"] = n2.lastRssi;
    nd2["snr"] = compactFloat(n2.lastSnr, 10.0F);
    nd2["pkt_count"] = n2.packetCount;
    nd2["drop_count"] = n2.dropCount;
    nd2["last_rx_ms"] = n2.lastRxMs;
  } else {
    nd2["seq"] = nullptr;
    nd2["age"] = nullptr;
    nd2["node_ms"] = nullptr;
    nd2["rssi"] = nullptr;
    nd2["snr"] = nullptr;
    nd2["pkt_count"] = 0;
    nd2["drop_count"] = 0;
    nd2["last_rx_ms"] = nullptr;
  }

  // --------------------------------------------------------------------------
  // 11. System Diagnostics
  // --------------------------------------------------------------------------
  JsonObject sysObj = doc.createNestedObject("system");
  sysObj["tx_drop"] = 0;
  sysObj["lora_rx"] = lora.rxPacketCount();
  sysObj["lora_drop"] = tracker.totalDrops();
  sysObj["json_drop"] = overflowDrops_;
  sysObj["cmd_overflow"] = 0;

  if (doc.overflowed()) {
    ++overflowDrops_;
    return 0;
  }

  const size_t bytesWritten = serializeJson(doc, outBuffer, maxCapacity);
  if (bytesWritten == 0 || bytesWritten >= maxCapacity) {
    ++overflowDrops_;
    return 0;
  }

  return bytesWritten;
}

size_t TelemetryFormatter::formatCommandReply(const char* cmd,
                                              bool ok,
                                              const char* reason,
                                              uint32_t nowMs,
                                              char* outBuffer,
                                              size_t maxCapacity) {
  if (outBuffer == nullptr || maxCapacity == 0) return 0;
  StaticJsonDocument<256> doc;
  doc["type"] = "command_reply";
  doc["schema"] = kTelemetrySchema;
  doc["ms"] = nowMs;
  doc["cmd"] = cmd ? cmd : "";
  doc["ok"] = ok ? 1 : 0;
  doc["reason"] = reason ? reason : "OK";
  return serializeJson(doc, outBuffer, maxCapacity);
}

size_t TelemetryFormatter::formatBootEvent(uint32_t nowMs,
                                          char* outBuffer,
                                          size_t maxCapacity) {
  if (outBuffer == nullptr || maxCapacity == 0) return 0;
  StaticJsonDocument<256> doc;
  doc["type"] = "boot";
  doc["schema"] = kTelemetrySchema;
  doc["fw"] = kFirmwareVersion;
  doc["mcu"] = FOGSEN_PLATFORM_NAME;
  doc["ms"] = nowMs;
  return serializeJson(doc, outBuffer, maxCapacity);
}

}  // namespace basestation
}  // namespace fogsen
