from __future__ import annotations

import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIRMWARE_ROOT = PROJECT_ROOT / "firmware"
SHARED_SOURCE = FIRMWARE_ROOT / "xiao_shared" / "include" / "FogSenXiaoNode.h"


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


def test_xiao_pin_and_tca_contracts_are_frozen() -> None:
    for node in ("front", "rear"):
        source = _config(node)
        assert _integer_constant(source, "kI2cSdaPin") == 22
        assert _integer_constant(source, "kI2cSclPin") == 23
        assert _integer_constant(source, "kNodeUartTxPin") == 16
        assert _integer_constant(source, "kNodeUartRxPin") == 17
        assert _integer_constant(source, "kServoPwmPin") == 2
        assert _integer_constant(source, "kTcaAddress") == 0x70

    assert '"FRONT"' in _config("front")
    assert '"fl"' in _config("front") and '"fr"' in _config("front")
    assert '"REAR"' in _config("rear")
    assert '"left"' in _config("rear") and '"right"' in _config("rear")


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


def test_node_packets_fit_the_fixed_transmit_buffer() -> None:
    packets = (
        {
            "node": "FRONT",
            "seq": 4_294_967_295,
            "ms": 4_294_967_295,
            "a": -80,
            "scan": 4000,
            "fl": 2000,
            "fr": 2000,
            "ok": 31,
        },
        {
            "node": "REAR",
            "seq": 4_294_967_295,
            "ms": 4_294_967_295,
            "a": -80,
            "scan": 4000,
            "left": 2000,
            "right": 2000,
            "ok": 31,
        },
    )
    for packet in packets:
        encoded = json.dumps(packet, separators=(",", ":")).encode()
        assert len(encoded) + 1 < 176


def test_all_node_commands_are_implemented() -> None:
    shared = SHARED_SOURCE.read_text(encoding="utf-8")
    for command in ("PING", "STATUS", "CENTER", "SCAN_ON", "SCAN_OFF", "SETTLE="):
        assert f'"{command}' in shared


def test_build_targets_and_library_versions_are_pinned() -> None:
    for node in ("front", "rear"):
        root = FIRMWARE_ROOT / f"{node}_xiao_esp32c6"
        readme = (root / "README.md").read_text(encoding="utf-8")
        platformio = (root / "platformio.ini").read_text(encoding="utf-8")
        assert "esp32:esp32:XIAO_ESP32C6" in readme
        assert "VL53L0X 1.3.1" in readme
        assert "VL53L1X 1.3.1" in readme
        assert "board = seeed-xiao-esp32-c6" in platformio
        assert "pololu/VL53L0X @ 1.3.1" in platformio
        assert "pololu/VL53L1X @ 1.3.1" in platformio
