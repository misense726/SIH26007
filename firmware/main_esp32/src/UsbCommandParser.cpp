#include "UsbCommandParser.h"

#include <ctype.h>
#include <string.h>

namespace fogsen {

UsbCommandParser::UsbCommandParser()
    : line_{0}, lineLength_(0), discardingOverflow_(false), overflowLines_(0) {}

void UsbCommandParser::poll(Stream& serial,
                            CommandHandler handler,
                            void* context) {
  size_t consumed = 0;
  while (serial.available() > 0 && consumed < config::kUsbBytesPerPoll) {
    const int next = serial.read();
    if (next < 0) {
      break;
    }
    ingest(static_cast<char>(next), handler, context);
    ++consumed;
  }
}

void UsbCommandParser::ingest(char value,
                              CommandHandler handler,
                              void* context) {
  if (value == '\r') {
    return;
  }
  if (value == '\n') {
    if (discardingOverflow_) {
      discardingOverflow_ = false;
      lineLength_ = 0;
      return;
    }
    if (lineLength_ > 0) {
      line_[lineLength_] = '\0';
      dispatch(handler, context);
      lineLength_ = 0;
    }
    return;
  }
  if (discardingOverflow_) {
    return;
  }
  if (lineLength_ + 1 >= sizeof(line_)) {
    ++overflowLines_;
    discardingOverflow_ = true;
    lineLength_ = 0;
    return;
  }
  line_[lineLength_++] = value;
}

void UsbCommandParser::dispatch(CommandHandler handler, void* context) {
  size_t start = 0;
  while (start < lineLength_ && isspace(static_cast<unsigned char>(line_[start]))) {
    ++start;
  }
  size_t end = lineLength_;
  while (end > start && isspace(static_cast<unsigned char>(line_[end - 1]))) {
    --end;
  }
  if (end <= start || handler == nullptr) {
    return;
  }
  const size_t length = end - start;
  if (start > 0) {
    memmove(line_, line_ + start, length);
  }
  line_[length] = '\0';
  handler(line_, context);
}

}  // namespace fogsen
