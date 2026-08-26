#pragma once

#include <stdint.h>

namespace fogsen {
namespace safety_config {

// Keep these values aligned with config/safety.yaml until runtime
// configuration is introduced.
constexpr float kWarningTimeS = 2.2F;
constexpr float kCriticalTimeS = 1.25F;
constexpr float kEmergencyTimeS = 0.65F;
constexpr float kStationaryWarningM = 0.75F;
constexpr float kStationaryCriticalM = 0.45F;
constexpr float kStationaryEmergencyM = 0.22F;
constexpr float kReactionTimeS = 0.55F;
constexpr float kBrakingDecelerationMps2 = 1.8F;
constexpr float kSafetyMarginM = 0.25F;
constexpr uint32_t kEmergencyPersistenceMs = 350;

// Missing forward range evidence is a fault, not a clear path. A stationary
// bench remains powered, but a moving vehicle latches the cut after this delay.
constexpr uint32_t kSensorFaultCutPersistenceMs = 750;
constexpr float kMovingSpeedFloorMps = 0.05F;
constexpr float kResetMaxSpeedMps = 0.03F;

// V1 Hall sensors do not report direction. This build is therefore explicitly
// configured for forward travel. Change only after adding direction feedback.
constexpr int kConfiguredTravelDirection = 1;  // 1=FORWARD, -1=REVERSE, 0=UNKNOWN

constexpr uint8_t kMinimumValidForwardRanges = 2;

// One full healthy excursion from +50 through +80 and back to +50 takes six
// node cycles. The longest permitted cycle is 285 ms: 120 ms servo settle,
// 80 ms scanner timeout, 5 ms optical guard, and 80 ms fixed-sensor timeout.
// Keep the last valid in-sector scanner sample beyond that 1710 ms excursion.
constexpr uint32_t kForwardScannerEvidenceStaleMs = 1800;

// Most single-channel relay boards are active-high. Confirm the exact module
// on the bench. The setup guide explains the external boot-state bias resistor.
constexpr bool kRelayActiveHigh = true;
constexpr bool kLatchMotorCut = true;

}  // namespace safety_config
}  // namespace fogsen
