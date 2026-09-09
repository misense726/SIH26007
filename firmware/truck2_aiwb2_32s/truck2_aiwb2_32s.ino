/*
 * FogSen truck 2 GPS/LoRa sender.
 *
 * Target: Ai-Thinker Ai-WB2-32S-Kit (BL602).
 * The sender publishes one compact JSON packet every two seconds. The packet
 * is readable by the existing ESP8266 substation listener and includes a
 * stable vehicle id so more than one truck can share the radio channel.
 *
 * Wiring:
 *   SX1278 SCK=IO3, MOSI=IO12, MISO=IO5, NSS=IO4, RESET=IO14, DIO0 unused.
 *   NEO-6 TX -> IO11 (BL602 UART1 RX), NEO-6 RX is unused.
 *   All grounds common. Radio and GPS use their specified 3.3 V supply.
 */

#include <Arduino.h>
#include "src/LoRa.h"
#include <SPI.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

namespace {

constexpr char kVehicleId[] = "TRUCK_2";
constexpr char kRadioSchema[] = "fogsen.lora.v1";

// Ai-WB2-32S-Kit labels. IO3/IO12/IO5 are the explicit BL602 SPI bus pins.
constexpr uint8_t kLoraSck = 3;
constexpr uint8_t kLoraMosi = 12;
constexpr uint8_t kLoraMiso = 5;
constexpr uint8_t kLoraNss = 4;
constexpr uint8_t kLoraReset = 14;

// UART1 TX stays unconnected. RX matches the wiring supplied to the owner.
constexpr uint8_t kGpsTxPin = 17;
constexpr uint8_t kGpsRxPin = 11;
constexpr uint32_t kGpsBaud = 9600;

constexpr long kLoraFrequencyHz = 433000000L;
constexpr uint8_t kLoraSyncWord = 0x12;
constexpr int kLoraSpreadingFactor = 7;
constexpr long kLoraBandwidthHz = 125000L;
constexpr int kLoraCodingRate = 5;
constexpr long kLoraPreamble = 8;
constexpr uint32_t kPublishPeriodMs = 2000;
constexpr uint32_t kRadioRetryPeriodMs = 5000;
constexpr uint32_t kGpsStaleMs = 5000;
constexpr size_t kGpsLineCapacity = 128;
constexpr size_t kPacketCapacity = 256;

// The core's ISR explicitly drains Serial1; a second UART1 object loses input.
HardwareSerial& gpsSerial = Serial1;

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
bool loraReady = false;
uint32_t sequence = 0;
uint32_t lastPublishMs = 0;
uint32_t lastRadioAttemptMs = 0;
uint32_t gpsBytes = 0;
uint32_t gpsSentences = 0;
uint32_t txStartedMs = 0;
bool txPending = false;
bool gpsDiscarding = false;
bool softwareSpi = false;

// Mode 0, MSB first. GPIO timing avoids the BL602 hardware SPI driver.
uint8_t softwareTransfer(uint8_t value) {
  uint8_t result = 0;
  for (uint8_t mask = 0x80; mask != 0; mask >>= 1) {
    digitalWrite(kLoraMosi, (value & mask) ? HIGH : LOW);
    delayMicroseconds(2);
    digitalWrite(kLoraSck, HIGH);
    delayMicroseconds(2);
    result = static_cast<uint8_t>((result << 1) | (digitalRead(kLoraMiso) ? 1 : 0));
    digitalWrite(kLoraSck, LOW);
  }
  return result;
}

uint8_t softwareRegister(uint8_t address, uint8_t value) {
  digitalWrite(kLoraNss, LOW);
  softwareTransfer(address);
  const uint8_t result = softwareTransfer(value);
  digitalWrite(kLoraNss, HIGH);
  return result;
}

uint8_t radioRegister(uint8_t address, uint8_t value = 0) {
  if (softwareSpi) return softwareRegister(address, value);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(kLoraNss, LOW);
  SPI.transfer(address);
  const uint8_t result = SPI.transfer(value);
  digitalWrite(kLoraNss, HIGH);
  SPI.endTransaction();
  return result;
}

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
  packet += F("\",\"node\":\"");
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
  packet += F(",\"hdop\":");
  appendFloatOrNull(packet, gps.hdop, gps.hasFix && gps.hasHdop &&
                    nowMs - gps.ggaMs <= kGpsStaleMs, 1);
  packet += F(",\"age\":");
  if (gps.hasFix) packet += nowMs - gps.lastFixMs;
  else packet += F("null");
  packet += F("},\"mode\":\"LIVE\"}");
  return packet;
}

bool beginRadio() {
  softwareSpi = false;
  LoRa.setRegisterTransfer(nullptr);
  SPI.begin(kLoraSck, kLoraMosi, kLoraMiso, kLoraNss);
  LoRa.setPins(kLoraNss, kLoraReset, -1);
  LoRa.setSPIFrequency(1000000);
  if (!LoRa.begin(kLoraFrequencyHz)) {
    Serial.print(F("LORA_HW_VERSION=0x"));
    Serial.println(radioRegister(0x42), HEX);
    SPI.end();
    digitalWrite(kLoraNss, HIGH);
    pinMode(kLoraNss, OUTPUT);
    digitalWrite(kLoraSck, LOW);
    pinMode(kLoraSck, OUTPUT);
    digitalWrite(kLoraMosi, LOW);
    pinMode(kLoraMosi, OUTPUT);
    pinMode(kLoraMiso, INPUT);
    softwareSpi = true;
    LoRa.setRegisterTransfer(softwareRegister);
    const bool found = LoRa.begin(kLoraFrequencyHz);
    Serial.print(F("LORA_SW_VERSION=0x"));
    Serial.println(radioRegister(0x42), HEX);
    if (!found) {
      loraReady = false;
      Serial.println(F("LORA_INIT_FAILED hardware_and_software_SPI"));
      return false;
    }
  }
  LoRa.setSyncWord(kLoraSyncWord);
  LoRa.setSpreadingFactor(kLoraSpreadingFactor);
  LoRa.setSignalBandwidth(kLoraBandwidthHz);
  LoRa.setCodingRate4(kLoraCodingRate);
  LoRa.setPreambleLength(kLoraPreamble);
  LoRa.enableCrc();
  LoRa.setTxPower(17);
  loraReady = true;
  Serial.println(softwareSpi ? F("LORA_BUS=SOFTWARE_SPI") : F("LORA_BUS=HARDWARE_SPI"));
  Serial.println(F("LORA_READY 433000000Hz sync=0x12 sf=7 bw=125000 cr=4/5"));
  return true;
}

void publish(uint32_t nowMs) {
  if (txPending) return;
  const String packet = makePacket(nowMs);
  Serial.print(F("SAMPLE "));
  Serial.println(packet);
  Serial.print(F("GPS bytes="));
  Serial.print(gpsBytes);
  Serial.print(F(" sentences="));
  Serial.println(gpsSentences);
  if (packet.length() > 255) {
    Serial.println(F("PACKET_TOO_LARGE"));
    return;
  }
  if (!loraReady) {
    return;
  }
  LoRa.idle();
  if (!LoRa.beginPacket()) {
    Serial.println(F("LORA_TX_BEGIN_FAILED"));
    return;
  }
  if (LoRa.print(packet) != packet.length()) {
    Serial.println(F("LORA_WRITE_FAILED"));
    return;
  }
  radioRegister(0x92, 0xFF);
  LoRa.endPacket(true);
  txStartedMs = millis();
  txPending = true;
}

void pollTransmit(uint32_t nowMs) {
  if (!txPending) return;
  if (radioRegister(0x12) & 0x08) {
    radioRegister(0x92, 0x08);
    txPending = false;
    Serial.print(F("LORA_TX_OK seq="));
    Serial.println(sequence);
    ++sequence;
  } else if (nowMs - txStartedMs > 1500) {
    Serial.println(F("LORA_TX_TIMEOUT"));
    txPending = false;
    loraReady = false;
    LoRa.idle();
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(F("FOGSEN TRUCK_2 BOOT fw=0.1.1"));
  gpsSerial.begin(kGpsBaud, kGpsTxPin, kGpsRxPin);
  Serial.println(F("GPS_UART_READY rx=IO11 baud=9600 tx=IO17_UNCONNECTED"));
  beginRadio();
  lastPublishMs = millis() - kPublishPeriodMs;
}

void loop() {
  const uint32_t nowMs = millis();
  pollGps(nowMs);
  pollTransmit(nowMs);
  if (!loraReady && nowMs - lastRadioAttemptMs >= kRadioRetryPeriodMs) {
    lastRadioAttemptMs = nowMs;
    beginRadio();
  }
  if (nowMs - lastPublishMs >= kPublishPeriodMs) {
    lastPublishMs = nowMs;
    publish(nowMs);
  }
  delay(2);
}
