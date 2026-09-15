#include "LoraTransmitter.h"
#include <LoRa.h>
#include "FirmwareConfig.h"
#include "Pins.h"

namespace fogsen {

LoraTransmitter::LoraTransmitter()
    : status_(LoraStatus::kOffline),
      txCount_(0),
      txFailCount_(0),
      lastTxMs_(0),
      vspi_(VSPI) {}

bool LoraTransmitter::begin(uint32_t nowMs) {
  status_ = LoraStatus::kInitializing;

  vspi_.begin(pins::kLoraSck, pins::kLoraMiso, pins::kLoraMosi, pins::kLoraCs);
  LoRa.setSPI(vspi_);
  LoRa.setPins(pins::kLoraCs, pins::kLoraRst, pins::kLoraDio0);

  if (!LoRa.begin(config::kLoraFrequency)) {
    status_ = LoraStatus::kFault;
    return false;
  }

  LoRa.setSignalBandwidth(config::kLoraBandwidth);
  LoRa.setSpreadingFactor(config::kLoraSpreadingFactor);
  LoRa.setCodingRate4(config::kLoraCodingRate);
  LoRa.setSyncWord(config::kLoraSyncWord);
  LoRa.setTxPower(config::kLoraTxPower);
  LoRa.enableCrc();

  status_ = LoraStatus::kHealthy;
  lastTxMs_ = nowMs;
  return true;
}

bool LoraTransmitter::sendTelemetry(const LoraTelemetryPacket& packet, uint32_t nowMs) {
  if (status_ != LoraStatus::kHealthy) {
    ++txFailCount_;
    return false;
  }

  LoRa.beginPacket();
  LoRa.write(reinterpret_cast<const uint8_t*>(&packet), sizeof(packet));
  const int result = LoRa.endPacket(true);  // async non-blocking

  if (result != 0) {
    ++txCount_;
    lastTxMs_ = nowMs;
    return true;
  } else {
    ++txFailCount_;
    return false;
  }
}

const char* loraStatusName(LoraStatus status) {
  switch (status) {
    case LoraStatus::kOffline:
      return "OFFLINE";
    case LoraStatus::kInitializing:
      return "INITIALIZING";
    case LoraStatus::kHealthy:
      return "HEALTHY";
    case LoraStatus::kFault:
      return "FAULT";
    default:
      return "UNKNOWN";
  }
}

}  // namespace fogsen
