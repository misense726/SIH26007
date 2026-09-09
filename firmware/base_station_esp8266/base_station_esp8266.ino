/*
 * FogSen SX1278 base station receiver for an ESP8266/Wemos D1 mini.
 *
 * This is the FogSen-local replacement for the old base-station sketch. It
 * prints every received LoRa JSON packet and optionally forwards the raw line
 * to a TCP listener on the laptop. Keep the current working base-station image
 * installed until Wi-Fi credentials and the backend address are configured.
 */

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <LoRa.h>
#include <SPI.h>

#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#else
#define FOGSEN_WIFI_SSID ""
#define FOGSEN_WIFI_PASSWORD ""
#define FOGSEN_PC_HOST ""
#endif

namespace {

constexpr uint8_t kLoraNss = D8;
constexpr uint8_t kLoraReset = D0;
constexpr uint8_t kLoraDio0 = D1;
constexpr long kLoraFrequencyHz = 433000000L;
constexpr uint8_t kLoraSyncWord = 0x12;
constexpr uint16_t kFogSenTcpPort = 8765;
constexpr uint32_t kWifiRetryMs = 10000;
constexpr uint32_t kPacketStatusMs = 5000;

WiFiClient client;
bool loraReady = false;
uint32_t packetsReceived = 0;
uint32_t packetsForwarded = 0;
uint32_t packetsDropped = 0;
uint32_t lastWifiAttemptMs = 0;
uint32_t lastStatusMs = 0;
uint32_t lastTcpAttemptMs = 0;
uint32_t lastRadioAttemptMs = 0;

bool beginRadio() {
  SPI.begin();
  LoRa.setPins(kLoraNss, kLoraReset, kLoraDio0);
  if (!LoRa.begin(kLoraFrequencyHz)) {
    Serial.println(F("LORA_INIT_FAILED"));
    loraReady = false;
    return false;
  }
  LoRa.setSyncWord(kLoraSyncWord);
  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setPreambleLength(8);
  LoRa.enableCrc();
  LoRa.receive();
  loraReady = true;
  Serial.println(F("LORA_READY 433000000Hz sync=0x12 sf=7 bw=125000 cr=4/5"));
  return true;
}

void maintainWifi(uint32_t nowMs) {
  if (strlen(FOGSEN_WIFI_SSID) == 0) return;
  if (WiFi.status() == WL_CONNECTED) {
    if (client.connected()) {
      return;
    }
    if (strlen(FOGSEN_PC_HOST) != 0 && nowMs - lastTcpAttemptMs >= 5000) {
      lastTcpAttemptMs = nowMs;
      client.setTimeout(250);
      client.connect(FOGSEN_PC_HOST, kFogSenTcpPort);
    }
    return;
  }
  if (nowMs - lastWifiAttemptMs < kWifiRetryMs) {
    return;
  }
  lastWifiAttemptMs = nowMs;
  WiFi.mode(WIFI_STA);
  WiFi.begin(FOGSEN_WIFI_SSID, FOGSEN_WIFI_PASSWORD);
  Serial.print(F("WIFI_CONNECTING ssid="));
  Serial.println(FOGSEN_WIFI_SSID);
}

void receiveLoRa(uint32_t nowMs) {
  if (!loraReady) {
    return;
  }
  const int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) {
    return;
  }
  String packet;
  packet.reserve(packetSize + 1);
  while (LoRa.available()) {
    packet += static_cast<char>(LoRa.read());
  }
  ++packetsReceived;
  const int rssi = LoRa.packetRssi();
  const float snr = LoRa.packetSnr();
  Serial.print(F("LORA_RX seq_count="));
  Serial.print(packetsReceived);
  Serial.print(F(" bytes="));
  Serial.print(packet.length());
  Serial.print(F(" rssi="));
  Serial.print(rssi);
  Serial.print(F(" snr="));
  Serial.print(snr, 1);
  Serial.print(F(" packet="));
  Serial.println(packet);

  if (!client.connected()) {
    ++packetsDropped;
    LoRa.receive();
    return;
  }
  const size_t sent = client.write(reinterpret_cast<const uint8_t*>(packet.c_str()), packet.length());
  if (sent == packet.length() && client.write('\n') == 1) {
    ++packetsForwarded;
  } else {
    ++packetsDropped;
    client.stop();
  }
  (void)nowMs;
  LoRa.receive();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(F("FOGSEN BASE_STATION BOOT fw=0.1.0"));
  beginRadio();
  WiFi.persistent(false);
  if (strlen(FOGSEN_WIFI_SSID) != 0) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(FOGSEN_WIFI_SSID, FOGSEN_WIFI_PASSWORD);
  } else {
    WiFi.mode(WIFI_OFF);
  }
}

void loop() {
  const uint32_t nowMs = millis();
  if (!loraReady && nowMs - lastRadioAttemptMs >= 5000) {
    lastRadioAttemptMs = nowMs;
    beginRadio();
  }
  maintainWifi(nowMs);
  receiveLoRa(nowMs);
  if (nowMs - lastStatusMs >= kPacketStatusMs) {
    lastStatusMs = nowMs;
    Serial.print(F("STATUS lora="));
    Serial.print(loraReady ? F("ready") : F("offline"));
    Serial.print(F(" wifi="));
    Serial.print(WiFi.status() == WL_CONNECTED ? F("connected") : F("offline"));
    Serial.print(F(" rx="));
    Serial.print(packetsReceived);
    Serial.print(F(" forwarded="));
    Serial.print(packetsForwarded);
    Serial.print(F(" dropped="));
    Serial.println(packetsDropped);
  }
  yield();
}
