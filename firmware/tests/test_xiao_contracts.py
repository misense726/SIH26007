from __future__ import annotations

import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIRMWARE_ROOT = PROJECT_ROOT / "firmware"
SHARED_SOURCE = FIRMWARE_ROOT / "xiao_shared" / "include" / "FogSenXiaoNode.h"
MIDDLE_ROOT = FIRMWARE_ROOT / "middle_esp32c3_supermini"


def _source_text() -> str:
    suffixes = {".h", ".cpp", ".ino"}
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in FIRMWARE_ROOT.rglob("*")
        if path.suffix in suffixes
    )


def _config(node: str) -> str:
    return (FIRMWARE_ROOT / f"{node}_xiao_esp32c6" / "node_config.h").read_text(
        encoding="utf-8"
    )


def _integer_constant(source: str, name: str) -> int:
    match = re.search(
        rf"constexpr\s+\w+\s+{name}\s*=\s*(-?(?:0x[0-9A-Fa-f]+|\d+))\s*;",
        source,
    )
    assert match, f"Missing constant {name}"
    return int(match.group(1), 0)


def test_legacy_firmware_tree_is_removed() -> None:
    assert not (FIRMWARE_ROOT / "esp32").exists()


def test_front_xiao_and_middle_c3_pin_contracts_are_frozen() -> None:
    front = _config("front")
    assert _integer_constant(front, "kI2cSdaPin") == 22
    assert _integer_constant(front, "kI2cSclPin") == 23
    assert _integer_constant(front, "kNodeUartTxPin") == 16
    assert _integer_constant(front, "kNodeUartRxPin") == 17
    assert _integer_constant(front, "kServoPwmPin") == 2
    assert _integer_constant(front, "kScannerXshutPin") == 0
    assert _integer_constant(front, "kScannerI2cAddress") == 0x30
    assert _integer_constant(front, "kFrontXshutPin") == 1
    assert _integer_constant(front, "kFrontI2cAddress") == 0x31

    middle = (MIDDLE_ROOT / "node_config.h").read_text(encoding="utf-8")
    assert _integer_constant(middle, "kLeftXshutPin") == 0
    assert _integer_constant(middle, "kRightXshutPin") == 1
    assert _integer_constant(middle, "kI2cSdaPin") == 4
    assert _integer_constant(middle, "kI2cSclPin") == 5
    assert _integer_constant(middle, "kNodeUartTxPin") == 21
    assert _integer_constant(middle, "kNodeUartRxPin") == 20
    assert _integer_constant(middle, "kLeftI2cAddress") == 0x31
    assert _integer_constant(middle, "kRightI2cAddress") == 0x32
    assert '"MIDDLE"' in middle
    used_middle_pins = {
        _integer_constant(middle, name)
        for name in (
            "kLeftXshutPin",
            "kRightXshutPin",
            "kI2cSdaPin",
            "kI2cSclPin",
            "kNodeUartTxPin",
            "kNodeUartRxPin",
        )
    }
    assert used_middle_pins.isdisjoint({2, 8, 9, 18, 19})


def test_xiao_source_uses_bounded_wired_state_machines() -> None:
    source = _source_text()
    for forbidden in (
        "<WiFi.h>",
        "<BluetoothSerial.h>",
        "esp_now_init",
        "BLEDevice",
        "readStringUntil",
        "delay(",
        "while (true)",
        "while(1)",
    ):
        assert forbidden not in source

    shared = SHARED_SOURCE.read_text(encoding="utf-8")
    assert "Serial1.begin" in shared
    assert "ledcAttach" in shared and "ledcWrite" in shared
    assert "scanner_sensor_.readSingle(false)" in shared
    assert "scanner_sensor_.dataReady()" in shared
    assert "readRangeSingleMillimeters" in shared
    assert "consumed < 64U" in shared
    assert "runNodeAddressSequence" in shared
    assert "holdAllSensorsInReset" in shared
    assert "releaseSensorFromReset" in shared
    assert "pinMode(pin, INPUT)" in shared
    assert "setAddress(config_.scanner_i2c_address)" in shared
    assert "setAddress(i2c_address)" in shared
    assert "scanner_sensor_ = VL53L1X();" in shared
    assert "sensor = VL53L0X();" in shared
    assert "probeI2cAddress" in shared
    assert "inter_sensor_guard_ms" in shared
    assert "scheduleNodeAddressRecovery" in shared

    middle = (MIDDLE_ROOT / "MiddleFixedNode.h").read_text(encoding="utf-8")
    assert "Serial0.begin" in middle
    assert "holdAllSensorsInReset" in middle
    assert "pinMode(pin, INPUT)" in middle
    assert "runAddressSequence" in middle
    assert "readRangeSingleMillimeters" in middle
    assert "inter_sensor_guard_ms" in middle


def test_no_i2c_multiplexer_contract_remains() -> None:
    source = _source_text().lower()
    assert "selectbuschannel" not in source
    assert "i2c_switch_address" not in source
    assert "channel_mask" not in source


def test_node_packets_fit_the_fixed_transmit_buffer() -> None:
    packets = (
        {
            "node": "FRONT",
            "seq": 4_294_967_295,
            "ms": 4_294_967_295,
            "a": -80,
            "scan": 4000,
            "scan_ms": 4_294_967_295,
            "front": 2000,
            "front_ms": 4_294_967_295,
            "ok": 11,
        },
        {
            "node": "MIDDLE",
            "seq": 4_294_967_295,
            "ms": 4_294_967_295,
            "left": 2000,
            "left_ms": 4_294_967_295,
            "right": 2000,
            "right_ms": 4_294_967_295,
            "ok": 6,
        },
    )
    for packet in packets:
        encoded = json.dumps(packet, separators=(",", ":")).encode()
        assert len(encoded) + 1 < 176


def test_all_node_commands_are_implemented() -> None:
    shared = SHARED_SOURCE.read_text(encoding="utf-8")
    for command in ("PING", "STATUS", "CENTER", "SCAN_ON", "SCAN_OFF", "SETTLE="):
        assert f'"{command}' in shared
    middle = (MIDDLE_ROOT / "MiddleFixedNode.h").read_text(encoding="utf-8")
    for command in ("PING", "STATUS", "RECOVER"):
        assert f'"{command}' in middle


def test_build_targets_and_library_versions_are_pinned() -> None:
    front = FIRMWARE_ROOT / "front_xiao_esp32c6"
    front_readme = (front / "README.md").read_text(encoding="utf-8")
    front_platformio = (front / "platformio.ini").read_text(encoding="utf-8")
    assert "esp32:esp32:XIAO_ESP32C6" in front_readme
    assert "board = seeed-xiao-esp32-c6" in front_platformio
    assert "pololu/VL53L0X @ 1.3.1" in front_platformio
    assert "pololu/VL53L1X @ 1.3.1" in front_platformio

    middle_readme = (MIDDLE_ROOT / "README.md").read_text(encoding="utf-8")
    middle_platformio = (MIDDLE_ROOT / "platformio.ini").read_text(
        encoding="utf-8"
    )
    assert "esp32:esp32:esp32c3:CDCOnBoot=cdc" in middle_readme
    assert "board = esp32-c3-devkitm-1" in middle_platformio
    assert "pololu/VL53L0X @ 1.3.1" in middle_platformio
