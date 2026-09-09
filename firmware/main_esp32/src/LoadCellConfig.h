#pragma once
#include <stdint.h>
namespace fogsen { namespace load_config {
// Unloaded tare captured from 86 live samples on 2026-09-09.
constexpr int32_t kZeroOffset = -286025;
// Set after measuring one known mass. Zero disables kg conversion.
constexpr float kCountsPerKg = 0.0F;
constexpr uint32_t kStaleMs = 1000;
} }
