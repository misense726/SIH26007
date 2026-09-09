/* FogSen truck 2: direct Wi-Fi. GPS TX -> D1, RX unconnected. */

#include <Arduino.h>
#include <ESP8266HTTPClient.h>
#include "wifi_secrets.h"
#include <SoftwareSerial.h>
#include <ESP8266WiFi.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

namespace {

constexpr char kVehicleId[] = "DUMPER_02";
constexpr char kRadioSchema[] = "fogsen.vehicle.v1";

constexpr uint8_t kGpsRxPin = D1;
constexpr uint32_t kGpsBaud = 9600;

constexpr uint32_t kPublishPeriodMs = 1000;
constexpr uint32_t kGpsStaleMs = 5000;
constexpr size_t kGpsLineCapacity = 128;
constexpr size_t kPacketCapacity = 256;

SoftwareSerial gpsSerial;

struct GpsState {
  bool hasFix = false;
  double latitude = 0.0;
  double longitude = 0.0;
  double altitudeM = 0.0;
  double speedMps = 0.0;
  double hdop = 0.0;
  uint16_t satellites = 0;
  uint32_t lastFixMs = 0;
  bool hasAltitude = false;
  bool hasHdop = false;
  bool hasSpeed = false;
  uint32_t ggaMs = 0;
  uint32_t speedMs = 0;
};

GpsState gps;
char gpsLine[kGpsLineCapacity];
size_t gpsLineLength = 0;
WiFiClient backendClient;
uint32_t lastWifiAttemptMs = 0;
uint32_t sequence = 0;
uint32_t lastPublishMs = 0;
uint32_t gpsBytes = 0;
uint32_t gpsSentences = 0;
bool gpsDiscarding = false;
bool checksumValid(const char* line) {
  if (line == nullptr || line[0] != '$') {
    return false;
  }
  const char* star = strchr(line, '*');
  if (star == nullptr || star[1] == '\0' || star[2] == '\0') {
    return false;
  }
  uint8_t checksum = 0;
  for (const char* cursor = line + 1; cursor < star; ++cursor) {
    checksum ^= static_cast<uint8_t>(*cursor);
  }
  char* end = nullptr;
  const unsigned long expected = strtoul(star + 1, &end, 16);
  return end == star + 3 && expected <= 0xFF &&
         checksum == static_cast<uint8_t>(expected);
}

double nmeaCoordinate(const char* value, const char* hemisphere) {
  if (value == nullptr || hemisphere == nullptr || value[0] == '\0' ||
      hemisphere[0] == '\0') {
    return NAN;
  }
  char* end = nullptr;
  const double raw = strtod(value, &end);
  if (*end != '\0' || !isfinite(raw) || raw < 0.0 || raw > 18000.0 ||
      hemisphere[1] != '\0' || strchr("NSEW", hemisphere[0]) == nullptr) {
    return NAN;
  }
  const double degrees = static_cast<unsigned int>(raw / 100.0);
  if (raw - degrees * 100.0 >= 60.0) return NAN;
  double decimal = degrees + (raw - degrees * 100.0) / 60.0;
  if (hemisphere[0] == 'S' || hemisphere[0] == 'W') {
    decimal = -decimal;
  }
  return decimal;
}

void parseGpsLine(char* line, uint32_t nowMs) {
  if (!checksumValid(line)) {
    return;
  }
  ++gpsSentences;
  char* checksum = strchr(line, '*');
  if (checksum != nullptr) {
    *checksum = '\0';
  }

  char* fields[20] = {};
  size_t fieldCount = 0;
  char* cursor = line;
  while (cursor != nullptr && fieldCount < 20) {
    fields[fieldCount++] = cursor;
    char* comma = strchr(cursor, ',');
    if (comma == nullptr) {
      break;
    }
    *comma = '\0';
    cursor = comma + 1;
  }
  if (fieldCount == 0 || fields[0] == nullptr) {
    return;
  }

  const bool isRmc = strcmp(fields[0] + 1, "GPRMC") == 0 ||
                    strcmp(fields[0] + 1, "GNRMC") == 0;
  const bool isGga = strcmp(fields[0] + 1, "GPGGA") == 0 ||
                    strcmp(fields[0] + 1, "GNGGA") == 0;
  if (isRmc && fieldCount >= 8) {
    if (strcmp(fields[2], "A") != 0) {
      gps.hasFix = false;
      gps.hasSpeed = false;
      return;
    }
    const double latitude = nmeaCoordinate(fields[3], fields[4]);
    const double longitude = nmeaCoordinate(fields[5], fields[6]);
    if (latitude >= -90.0 && latitude <= 90.0 && longitude >= -180.0 &&
        longitude <= 180.0) {
      gps.latitude = latitude;
      gps.longitude = longitude;
      char* end = nullptr;
      gps.speedMps = strtod(fields[7], &end) * 0.514444;
      gps.hasSpeed = end != fields[7] && *end == '\0' &&
                     isfinite(gps.speedMps) && gps.speedMps >= 0.0;
      gps.speedMs = nowMs;
      gps.hasFix = true;
      gps.lastFixMs = nowMs;
    }
  } else if (isGga && fieldCount >= 10) {
    const int fixQuality = atoi(fields[6]);
    gps.ggaMs = nowMs;
    gps.hasAltitude = false;
    gps.hasHdop = false;
    if (fixQuality <= 0) gps.hasFix = false;
    gps.satellites = static_cast<uint16_t>(max(0, atoi(fields[7])));
    if (fields[8][0] != '\0') {
      gps.hdop = atof(fields[8]);
      gps.hasHdop = fixQuality > 0 && isfinite(gps.hdop) && gps.hdop > 0.0;
    }
    if (fields[9][0] != '\0') {
      gps.altitudeM = atof(fields[9]);
      gps.hasAltitude = fixQuality > 0 && isfinite(gps.altitudeM);
    }
    if (fixQuality > 0) {
      const double latitude = nmeaCoordinate(fields[2], fields[3]);
      const double longitude = nmeaCoordinate(fields[4], fields[5]);
      if (latitude >= -90.0 && latitude <= 90.0 && longitude >= -180.0 &&
          longitude <= 180.0) {
        gps.latitude = latitude;
        gps.longitude = longitude;
        gps.hasFix = true;
        gps.lastFixMs = nowMs;
      }
    }
  }
}

void pollGps(uint32_t nowMs) {
  size_t consumed = 0;
  while (gpsSerial.available() > 0 && consumed++ < 256) {
    const int value = gpsSerial.read();
    if (value < 0) {
      return;
    }
    const char character = static_cast<char>(value);
    ++gpsBytes;
    if (character == '$') {
      gpsLineLength = 0;
      gpsDiscarding = false;
    }
    if (character == '\n') {
      gpsLine[gpsLineLength] = '\0';
      if (!gpsDiscarding) parseGpsLine(gpsLine, nowMs);
      gpsLineLength = 0;
      gpsDiscarding = false;
    } else if (character != '\r' && !gpsDiscarding) {
      if (gpsLineLength + 1 < sizeof(gpsLine)) {
        gpsLine[gpsLineLength++] = character;
      } else {
        gpsLineLength = 0;
        gpsDiscarding = true;
      }
    }
  }
  if (gps.hasFix && nowMs - gps.lastFixMs > kGpsStaleMs) {
    gps.hasFix = false;
  }
}

void appendFloatOrNull(String& packet, double value, bool present,
                       uint8_t decimals) {
  if (present) {
    packet += String(value, decimals);
  } else {
    packet += F("null");
  }
}

String makePacket(uint32_t nowMs) {
  String packet;
  packet.reserve(kPacketCapacity);
  packet += F("{\"schema\":\"");
  packet += kRadioSchema;
  packet += F("\",\"vehicle_id\":\"");
  packet += kVehicleId;
  packet += F("\",\"seq\":");
  packet += sequence;
  packet += F(",\"ms\":");
  packet += nowMs;
  packet += F(",\"gps\":{\"fix\":");
  packet += gps.hasFix ? F("true") : F("false");
  packet += F(",\"lat\":");
  appendFloatOrNull(packet, gps.latitude, gps.hasFix, 6);
  packet += F(",\"lon\":");
  appendFloatOrNull(packet, gps.longitude, gps.hasFix, 6);
  packet += F(",\"alt_m\":");
  appendFloatOrNull(packet, gps.altitudeM, gps.hasFix && gps.hasAltitude &&
                    nowMs - gps.ggaMs <= kGpsStaleMs, 1);
  packet += F(",\"speed_mps\":");
  appendFloatOrNull(packet, gps.speedMps, gps.hasFix && gps.hasSpeed &&
                    nowMs - gps.speedMs <= kGpsStaleMs, 2);
  packet += F(",\"sats\":");
  packet += gps.satellites;
  packet += F(",\"bytes\":");
  packet += gpsBytes;
  packet += F(",\"hdop\":");
  appendFloatOrNull(packet, gps.hdop, gps.hasFix && gps.hasHdop &&
                    nowMs - gps.ggaMs <= kGpsStaleMs, 1);
  packet += F(",\"age\":");
  if (gps.hasFix) packet += nowMs - gps.lastFixMs;
  else packet += F("null");
  packet += F("},\"mode\":\"LIVE\"}");
  return packet;
}

void publish(uint32_t nowMs) {
  const String packet = makePacket(nowMs);
  ++sequence;
  Serial.printf("GPS bytes=%lu sentences=%lu fix=%d\n",
                (unsigned long)gpsBytes, (unsigned long)gpsSentences, gps.hasFix);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("WIFI_CONNECTING"));
    return;
  }
  HTTPClient http;
  http.setTimeout(350);
  backendClient.setTimeout(350);
  if (!http.begin(backendClient, wifi_secrets::kBackendUrl)) return;
  http.addHeader("Content-Type", "application/json");
  const int status = http.POST(packet);
  Serial.printf("WIFI_HTTP status=%d seq=%lu ip=%s\n", status,
                (unsigned long)(sequence - 1), WiFi.localIP().toString().c_str());
  http.end();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(kGpsBaud, SWSERIAL_8N1, kGpsRxPin, -1, false, 1024);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(wifi_secrets::kSsid, wifi_secrets::kPassword);
  lastWifiAttemptMs = millis();
  Serial.println(F("FOGSEN TRUCK_2 WIFI fw=0.2.0 GPS_RX=D1"));
}

void loop() {
  const uint32_t nowMs = millis();
  pollGps(nowMs);
  if (WiFi.status() != WL_CONNECTED && nowMs - lastWifiAttemptMs >= 15000) {
    lastWifiAttemptMs = nowMs;
    WiFi.begin(wifi_secrets::kSsid, wifi_secrets::kPassword);
  }
  if (nowMs - lastPublishMs >= kPublishPeriodMs) {
    lastPublishMs = nowMs;
    publish(nowMs);
  }
  delay(1);
}
