#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

#include "FirmwareConfig.h"

namespace fogsen {

typedef void (*CommandHandler)(const char* command, void* context);

class UsbCommandParser {
 public:
  UsbCommandParser();

  void poll(Stream& serial, CommandHandler handler, void* context);
  void ingest(char value, CommandHandler handler, void* context);

  uint32_t overflowLines() const { return overflowLines_; }

 private:
  void dispatch(CommandHandler handler, void* context);

  char line_[config::kUsbCommandCapacity];
  size_t lineLength_;
  bool discardingOverflow_;
  uint32_t overflowLines_;
};

}  // namespace fogsen
