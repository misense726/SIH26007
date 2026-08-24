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
    common = {"node", "seq", "ms", "a", "scan", "ok"}
    fixed = {"fl", "fr"} if expected_node == "FRONT" else {"left", "right"}
    if not common | fixed <= packet.keys():
        return False
    if type(packet["seq"]) is not int or not 0 <= packet["seq"] <= 0xFFFFFFFF:
        return False
    if type(packet["ms"]) is not int or not 0 <= packet["ms"] <= 0xFFFFFFFF:
        return False
    if type(packet["a"]) is not int or not -90 <= packet["a"] <= 90:
        return False
    if type(packet["ok"]) is not int or not 0 <= packet["ok"] <= 255:
        return False
    if type(packet["scan"]) is not int or not -1 <= packet["scan"] <= 4000:
        return False
    return all(type(packet[key]) is int and -1 <= packet[key] <= 2000 for key in fixed)


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
        "kRearUartRx": 26,
        "kRearUartTx": 27,
        "kI2cSda": 21,
        "kI2cScl": 22,
        "kHallLeft": 32,
        "kHallRight": 33,
        "kMotorCutRelay": 25,
    }
    values = {name: int(_header_value("Pins.h", name)) for name in expected}
    assert values == expected
    assert len(set(values.values())) == len(values)


def test_frozen_node_packet_examples_and_unknown_sentinel() -> None:
    front = '{"node":"FRONT","seq":42,"ms":18120,"a":-30,"scan":-1,"fl":620,"fr":710,"ok":30}'
    rear = '{"node":"REAR","seq":43,"ms":18124,"a":25,"scan":930,"left":-1,"right":510,"ok":31}'
    assert _valid_node_packet(front, "FRONT")
    assert _valid_node_packet(rear, "REAR")
    assert not _valid_node_packet(front, "REAR")
    assert not _valid_node_packet(front.replace('"scan":-1', '"scan":4001'), "FRONT")
    assert not _valid_node_packet(front.replace('"fl":620', '"fl":-2'), "FRONT")


def test_source_has_no_wireless_stack_and_all_required_commands() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (FIRMWARE_ROOT / "src").glob("*")
        if path.suffix in {".h", ".cpp"}
    )
    for forbidden in ("<WiFi.h>", "<BluetoothSerial.h>", "esp_now_init", "BLEDevice"):
        assert forbidden not in source
    for command in (
        "STATUS",
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
