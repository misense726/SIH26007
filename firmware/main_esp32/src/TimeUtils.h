#pragma once

#include <stdint.h>

namespace fogsen {

inline uint32_t elapsedMs(uint32_t now, uint32_t then) {
  return static_cast<uint32_t>(now - then);
}

inline bool intervalElapsed(uint32_t now, uint32_t then, uint32_t interval) {
  return elapsedMs(now, then) >= interval;
}

inline bool timeReached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

}  // namespace fogsen
