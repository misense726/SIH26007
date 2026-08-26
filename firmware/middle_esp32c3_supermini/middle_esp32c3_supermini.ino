#include <Arduino.h>

namespace {

constexpr uint8_t kProbeLedPin = 8;
constexpr uint8_t kProbeUartRxPin = 21;
constexpr uint8_t kProbeUartTxPin = 20;
constexpr uint32_t kProbeBaud = 115200;
constexpr uint32_t kProbePeriodMs = 100;

uint32_t probeSequence = 0;
uint32_t nextProbeMs = 0;
bool probeLedOn = false;

}  // namespace

void setup() {
  Serial.begin(kProbeBaud);
  Serial0.begin(kProbeBaud, SERIAL_8N1, kProbeUartRxPin, kProbeUartTxPin);
  pinMode(kProbeLedPin, OUTPUT);
  digitalWrite(kProbeLedPin, HIGH);
}

void loop() {
  const uint32_t nowMs = millis();
  if (static_cast<int32_t>(nowMs - nextProbeMs) < 0) {
    return;
  }
  nextProbeMs = nowMs + kProbePeriodMs;
  probeLedOn = !probeLedOn;
  digitalWrite(kProbeLedPin, probeLedOn ? LOW : HIGH);

  char packet[176];
  const int written = snprintf(
      packet, sizeof(packet),
      "{\"node\":\"MIDDLE\",\"seq\":%lu,\"ms\":%lu,\"left\":-1,\"left_ms\":%lu,\"right\":-1,\"right_ms\":%lu,\"ok\":0}",
      static_cast<unsigned long>(++probeSequence),
      static_cast<unsigned long>(nowMs), static_cast<unsigned long>(nowMs),
      static_cast<unsigned long>(nowMs));
  if (written <= 0 || static_cast<size_t>(written) >= sizeof(packet)) {
    return;
  }
  Serial0.println(packet);
  Serial.print("[DEBUG-MIDDLE-PROBE] ");
  Serial.println(packet);
}
