from __future__ import annotations

import json
import re
from pathlib import Path

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[3]
FIRMWARE_ROOT = PROJECT_ROOT / "firmware" / "main_esp32"


def _header_value(header: str, name: str) -> float:
    text = (FIRMWARE_ROOT / "src" / header).read_text(encoding="utf-8")
    match = re.search(rf"constexpr\s+[^;=]+\s+{name}\s*=\s*([-+0-9.]+)F?;", text)
    assert match, f"Missing constant {name} in {header}"
    return float(match.group(1))


def _valid_node_packet(raw: str, expected_node: str) -> bool:
    try:
        packet = json.loads(raw)
    except json.JSONDecodeError:
        return False
    if packet.get("node") != expected_node:
        return False
    common = {"node", "seq", "ms", "ok"}
    scanner = {"a", "scan", "scan_ms"} if expected_node == "FRONT" else set()
    fixed = {"front"} if expected_node == "FRONT" else {"left", "right"}
    fixed_times = {f"{key}_ms" for key in fixed}
    if not common | scanner | fixed | fixed_times <= packet.keys():
        return False
    if type(packet["seq"]) is not int or not 0 <= packet["seq"] <= 0xFFFFFFFF:
        return False
    if type(packet["ms"]) is not int or not 0 <= packet["ms"] <= 0xFFFFFFFF:
        return False
    if scanner and (type(packet["a"]) is not int or not -90 <= packet["a"] <= 90):
        return False
    allowed_mask = 0x0B if expected_node == "FRONT" else 0x06
    if (
        type(packet["ok"]) is not int
        or not 0 <= packet["ok"] <= 255
        or packet["ok"] & ~allowed_mask
    ):
        return False
    if scanner:
        if type(packet["scan"]) is not int or not -1 <= packet["scan"] <= 4000:
            return False
        if type(packet["scan_ms"]) is not int or not 0 <= packet["scan_ms"] <= 0xFFFFFFFF:
            return False
    if not all(
        type(packet[key]) is int and -1 <= packet[key] <= 2000 for key in fixed
    ):
        return False
    return all(
        type(packet[key]) is int and 0 <= packet[key] <= 0xFFFFFFFF
        for key in fixed_times
    )


def test_safety_constants_match_backend_yaml() -> None:
    safety = yaml.safe_load((PROJECT_ROOT / "config" / "safety.yaml").read_text())["safety"]
    mapping = {
        "kWarningTimeS": "warning_time_s",
        "kCriticalTimeS": "critical_time_s",
        "kEmergencyTimeS": "emergency_time_s",
        "kStationaryWarningM": "stationary_warning_m",
        "kStationaryCriticalM": "stationary_critical_m",
        "kStationaryEmergencyM": "stationary_emergency_m",
        "kReactionTimeS": "reaction_time_s",
        "kBrakingDecelerationMps2": "braking_deceleration_mps2",
    }
    for firmware_name, yaml_name in mapping.items():
        assert _header_value("SafetyConfig.h", firmware_name) == float(safety[yaml_name])


def test_vehicle_calibration_matches_backend_yaml() -> None:
    vehicle = yaml.safe_load((PROJECT_ROOT / "config" / "vehicle.yaml").read_text())["vehicle"]
    assert _header_value("FirmwareConfig.h", "kWheelCircumferenceM") == float(
        vehicle["wheel_circumference_m"]
    )
    assert _header_value("FirmwareConfig.h", "kMagnetsPerWheel") == float(
        vehicle["magnets_per_wheel"]
    )


def test_pin_plan_is_frozen_and_has_no_collisions() -> None:
    expected = {
        "kFrontUartRx": 16,
        "kFrontUartTx": 17,
        "kMiddleUartRx": 26,
        "kMiddleUartTx": 27,
        "kI2cSda": 21,
        "kI2cScl": 22,
        "kRearScannerXshut": 13,
        "kRearServoPwm": 14,
        "kHallLeft": 32,
        "kHallRight": 33,
        "kMotorCutRelay": 25,
    }
    values = {name: int(_header_value("Pins.h", name)) for name in expected}
    assert values == expected
    assert len(set(values.values())) == len(values)


def test_current_profile_keeps_hall_and_relay_code_dormant() -> None:
    config = (FIRMWARE_ROOT / "src" / "FirmwareConfig.h").read_text(
        encoding="utf-8"
    )
    source = (FIRMWARE_ROOT / "src" / "main.cpp").read_text(encoding="utf-8")

    assert "constexpr bool kHallSensorsEnabled = false;" in config
    assert "constexpr bool kMotorCutRelayEnabled = false;" in config
    assert "if (config::kHallSensorsEnabled)" in source
    assert "if (!config::kMotorCutRelayEnabled)" in source
    assert 'wheel["enabled"] = config::kHallSensorsEnabled ? 1 : 0;' in source
    assert 'emergency["output_enabled"]' in source
    assert 'emergency["cut"] = relayCutApplied ? 1 : 0;' in source
    assert '"HALL_SENSORS_DISABLED"' in source
    assert '"RELAY_OUTPUT_DISABLED"' in source


def test_imu_zeroing_is_explicit_and_does_not_claim_absolute_position() -> None:
    config = (FIRMWARE_ROOT / "src" / "FirmwareConfig.h").read_text(
        encoding="utf-8"
    )
    sensors = (FIRMWARE_ROOT / "src" / "LocalSensors.cpp").read_text(
        encoding="utf-8"
    )
    source = (FIRMWARE_ROOT / "src" / "main.cpp").read_text(encoding="utf-8")

    assert "kImuZeroSampleCount = 100" in config
    assert "restartImuCalibration(nowMs);" in sensors
    assert "acceleration.acceleration.x - imuAccelerationBiasX_" in sensors
    assert "gyroZDps - imuGyroBiasZ_" in sensors
    assert 'imu["calibrated"] = imuReading.calibrated;' in source
    assert 'imu["zeroing"] = imuReading.zeroing;' in source
    assert 'strcmp(command, "ZERO_IMU") == 0' in source
    assert '"IMU_ZEROING_STARTED"' in source
    for forbidden in ('imu["x"]', 'imu["y"]', 'imu["position"]'):
        assert forbidden not in source


def test_frozen_node_packet_examples_and_unknown_sentinel() -> None:
    front = '{"node":"FRONT","seq":42,"ms":18120,"a":-30,"scan":-1,"scan_ms":18090,"front":620,"front_ms":18118,"ok":11}'
    middle = '{"node":"MIDDLE","seq":43,"ms":18124,"left":-1,"left_ms":18100,"right":510,"right_ms":18122,"ok":6}'
    assert _valid_node_packet(front, "FRONT")
    assert _valid_node_packet(middle, "MIDDLE")
    assert not _valid_node_packet(front, "MIDDLE")
    assert not _valid_node_packet(front.replace('"scan":-1', '"scan":4001'), "FRONT")
    assert not _valid_node_packet(
        front.replace('"front":620', '"front":-2'), "FRONT"
    )
    assert not _valid_node_packet(front.replace('"ok":11', '"ok":31'), "FRONT")
    assert not _valid_node_packet(
        middle.replace('"ok":6', '"ok":31'), "MIDDLE"
    )


def test_main_uses_five_range_contract_and_node_specific_health_masks() -> None:
    source = (FIRMWARE_ROOT / "src" / "main.cpp").read_text(encoding="utf-8")
    node_link = (FIRMWARE_ROOT / "src" / "NodeLink.h").read_text(encoding="utf-8")
    assert 'NodeLink frontNode(NodeRole::kFront, "front", nullptr);' in source
    assert 'NodeLink middleNode(NodeRole::kMiddle, "left", "right");' in source
    assert "RearScanner rearScanner(Wire);" in source
    assert "kFrontExpected = kScanner | kFixedA | kServo" in node_link
    assert "kMiddleExpected = kFixedA | kFixedB" in node_link
    assert "kBackExpected = kScanner | kFixedA | kFixedB | kServo" in node_link
    assert "unexpectedHealthBits != 0U" in (
        FIRMWARE_ROOT / "src" / "NodeLink.cpp"
    ).read_text(encoding="utf-8")
    assert 'object["scan_age"]' in source
    assert "node.fixedAAgeKey()" in source
    assert "node.fixedBAgeKey()" in source
    assert (
        'emergency["coverage"] = lastSafetyInput.coverageSufficient ? 1 : 0;'
        in source
    )
    assert _header_value("SafetyConfig.h", "kMinimumValidForwardRanges") == 2


def test_main_owns_rear_scanner_addressing_and_composes_rear_health() -> None:
    source = (FIRMWARE_ROOT / "src" / "RearScanner.cpp").read_text(
        encoding="utf-8"
    )
    main = (FIRMWARE_ROOT / "src" / "main.cpp").read_text(encoding="utf-8")
    assert "holdInReset();" in source
    assert "pinMode(pins::kRearScannerXshut, INPUT)" in source
    assert "sensor_.setAddress(config::kRearScannerI2cAddress)" in source
    assert "probe(config::kRearScannerI2cAddress)" in source
    assert "reading_.rangeMm = -1" in source
    assert "middleNode.packet().healthMask" in main
    assert "node_health_bits::kBackExpected" in main
    for key in ('object["scan"]', 'object["left"]', 'object["right"]'):
        assert key in main


def test_per_sensor_age_math_is_wrap_safe_and_saturating() -> None:
    source = (FIRMWARE_ROOT / "src" / "main.cpp").read_text(encoding="utf-8")
    assert "elapsedMs(node.packet().nodeMs, sampleNodeMs)" in source
    assert "UINT32_MAX - linkAgeMs < localAgeMs" in source

    def elapsed(now: int, then: int) -> int:
        return (now - then) & 0xFFFFFFFF

    packet_ms = 3
    sample_ms = 0xFFFFFFFE
    assert elapsed(packet_ms, sample_ms) == 5


def _cached_scanner_valid(
    sample_main_ms: int | None,
    now_ms: int,
    angle: int,
    scan_mm: int,
    health_mask: int = 0x0B,
    node_fresh: bool = True,
    node_rebooted: bool = False,
) -> int | None:
    stale_ms = int(
        _header_value("SafetyConfig.h", "kForwardScannerEvidenceStaleMs")
    )
    scanner_and_servo_healthy = health_mask & 0x09 == 0x09
    if not node_fresh or node_rebooted or not scanner_and_servo_healthy:
        return None
    if abs(angle) <= 50:
        if not 1 <= scan_mm <= 4000:
            return None
        sample_main_ms = now_ms
    if sample_main_ms is None:
        return None
    if ((now_ms - sample_main_ms) & 0xFFFFFFFF) > stale_ms:
        return None
    return sample_main_ms


def test_forward_scanner_cache_covers_complete_healthy_sweep() -> None:
    source = (FIRMWARE_ROOT / "src" / "main.cpp").read_text(encoding="utf-8")
    stale_ms = int(
        _header_value("SafetyConfig.h", "kForwardScannerEvidenceStaleMs")
    )
    assert stale_ms == 1800
    assert "frontScannerEvidence.sampleMainMs = nowMs - sampleAgeMs" in source
    assert "elapsedMs(nowMs, frontScannerEvidence.sampleMainMs)" in source

    cached_at = None
    coverage_fault_ms = 0
    for cycle, angle in enumerate((50, 60, 70, 80, 70, 60, 50)):
        now_ms = cycle * 285
        cached_at = _cached_scanner_valid(cached_at, now_ms, angle, 900)
        if cached_at is None:
            coverage_fault_ms += 285
        else:
            coverage_fault_ms = 0
        assert cached_at is not None
        assert coverage_fault_ms < 750
    assert 6 * 285 < stale_ms


def test_maximum_front_settle_keeps_full_sweep_inside_cache_lifetime() -> None:
    config = (
        PROJECT_ROOT / "firmware" / "front_xiao_esp32c6" / "node_config.h"
    ).read_text(encoding="utf-8")
    match = re.search(r"\n\s*(\d+),\s*// max_settle_ms", config)
    assert match, "Missing max_settle_ms in FRONT"
    maximum_settle_ms = int(match.group(1))
    assert maximum_settle_ms == 100

    scanner_timing_budget_ms = 20
    optical_guard_ms = 5
    fixed_timing_budget_ms = 20
    worst_cycle_ms = (
        maximum_settle_ms
        + scanner_timing_budget_ms
        + optical_guard_ms
        + fixed_timing_budget_ms
    )
    cache_ms = int(
        _header_value("SafetyConfig.h", "kForwardScannerEvidenceStaleMs")
    )
    out_of_sector_steps = 12
    assert out_of_sector_steps * worst_cycle_ms == 1740
    assert out_of_sector_steps * worst_cycle_ms < cache_ms


def test_live_tof_profile_uses_validated_fast_near_field_timing() -> None:
    front_config = (
        PROJECT_ROOT / "firmware" / "front_xiao_esp32c6" / "node_config.h"
    ).read_text(encoding="utf-8")
    middle_config = (
        PROJECT_ROOT
        / "firmware"
        / "middle_esp32c3_supermini"
        / "node_config.h"
    ).read_text(encoding="utf-8")
    main_config = (FIRMWARE_ROOT / "src" / "FirmwareConfig.h").read_text(
        encoding="utf-8"
    )
    rear_source = (FIRMWARE_ROOT / "src" / "RearScanner.cpp").read_text(
        encoding="utf-8"
    )

    assert "VL53L1X::Short,              // scanner_distance_mode" in front_config
    assert "20000,                       // scanner_timing_budget_us" in front_config
    assert "5,                           // scan_step_deg" in front_config
    assert "30,                          // default_settle_ms" in front_config
    assert "20,                         // sample_period_ms" in middle_config
    assert "constexpr uint32_t kTelemetryPeriodMs = 50;" in main_config
    assert "constexpr bool kRearScannerShortDistanceMode = true;" in main_config
    assert "constexpr uint32_t kRearScannerTimingBudgetUs = 20000;" in main_config
    assert "constexpr int16_t kRearScanStepDeg = 5;" in main_config
    assert "constexpr uint16_t kRearDefaultSettleMs = 30;" in main_config
    assert "? VL53L1X::Short" in rear_source


def test_front_recovery_clears_bus_before_readdressing_both_tofs() -> None:
    shared = (
        PROJECT_ROOT
        / "firmware"
        / "xiao_shared"
        / "include"
        / "FogSenXiaoNode.h"
    ).read_text(encoding="utf-8")
    front_config = (
        PROJECT_ROOT / "firmware" / "front_xiao_esp32c6" / "node_config.h"
    ).read_text(encoding="utf-8")

    assert "void clearI2cBus()" in shared
    assert "pulse < 16U" in shared
    assert "holdAllSensorsInReset();" in shared
    assert "configureI2cBus();" in shared
    assert "scanner_default_seen_ = probeI2cAddress(0x29);" in shared
    assert "fixed_a_default_seen_ = default_seen;" in shared
    assert "100000,                      // i2c_clock_hz" in front_config
    assert "50000,                       // xshut_reset_us" in front_config
    assert "20000,                       // xshut_boot_us" in front_config


def test_forward_scanner_cache_clears_on_each_failure_condition() -> None:
    cached_at = _cached_scanner_valid(None, 100, 50, 900)
    assert cached_at == 100
    assert _cached_scanner_valid(cached_at, 200, 60, 900, node_fresh=False) is None
    assert _cached_scanner_valid(cached_at, 200, 60, 900, node_rebooted=True) is None
    assert _cached_scanner_valid(cached_at, 200, 60, 900, health_mask=0x03) is None
    assert _cached_scanner_valid(cached_at, 200, 60, 900, health_mask=0x0A) is None
    assert _cached_scanner_valid(cached_at, 200, 50, -1) is None
    assert _cached_scanner_valid(cached_at, 200, 50, 4001) is None
    assert _cached_scanner_valid(cached_at, 1901, 60, 900) is None


def test_forward_scanner_cache_expiry_is_wrap_safe() -> None:
    stale_ms = int(
        _header_value("SafetyConfig.h", "kForwardScannerEvidenceStaleMs")
    )
    cached_at = _cached_scanner_valid(None, 0xFFFFFF00, 50, 900)
    assert cached_at == 0xFFFFFF00
    within_bound = (cached_at + stale_ms) & 0xFFFFFFFF
    assert _cached_scanner_valid(cached_at, within_bound, 60, 900) == cached_at
    expired = (cached_at + stale_ms + 1) & 0xFFFFFFFF
    assert _cached_scanner_valid(cached_at, expired, 60, 900) is None


def test_main_keeps_usb_fallback_and_uses_bounded_wifi_telemetry() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (FIRMWARE_ROOT / "src").glob("*")
        if path.suffix in {".h", ".cpp"}
    )
    for forbidden in ("<BluetoothSerial.h>", "esp_now_init", "BLEDevice"):
        assert forbidden not in source
    assert "<WiFi.h>" in source
    assert "xQueueCreate" in source
    assert "xTaskCreatePinnedToCore" in source
    assert "wifiTelemetry.enqueueLine" in source
    assert "laptopTx.enqueueLine" in source
    assert "wifi_secrets.h" in source
    assert (FIRMWARE_ROOT / "wifi_secrets.example.h").is_file()
    assert "wifi_secrets.h" in (PROJECT_ROOT / ".gitignore").read_text(
        encoding="utf-8"
    )


def test_main_keeps_all_required_commands() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (FIRMWARE_ROOT / "src").glob("*")
        if path.suffix in {".h", ".cpp"}
    )
    for command in (
        "STATUS",
        "ZERO_IMU",
        "ZERO_ALT",
        "RESET_TICKS",
        "ESTOP_TEST",
        "ESTOP_RESET",
        "FRONT_CENTER",
        "REAR_CENTER",
        "FRONT_SCAN_ON",
        "FRONT_SCAN_OFF",
        "REAR_SCAN_ON",
        "REAR_SCAN_OFF",
    ):
        assert f'"{command}"' in source


def test_rear_servo_sweep_does_not_depend_on_a_healthy_tof() -> None:
    header = (FIRMWARE_ROOT / "src" / "RearScanner.h").read_text(
        encoding="utf-8"
    )
    source = (FIRMWARE_ROOT / "src" / "RearScanner.cpp").read_text(
        encoding="utf-8"
    )

    assert "void advanceWithoutRange(uint32_t nowMs);" in header
    assert "void RearScanner::advanceWithoutRange(uint32_t nowMs)" in source
    assert "if (!sensorInitialized_)" in source
    assert "advanceWithoutRange(nowMs);" in source
    assert "reading_.rangeMm = -1;" in source
