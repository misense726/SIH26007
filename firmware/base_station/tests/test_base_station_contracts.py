from __future__ import annotations

import re
import struct
from pathlib import Path

import pytest

from backend.app.providers.serial_protocol import (
    parse_main_packet,
    translate_main_packet,
)

BASE_STATION_ROOT = Path(__file__).resolve().parents[1]
MAIN_ESP32_ROOT = Path(__file__).resolve().parents[2] / "main_esp32"


def _header_value(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"constexpr\s+[^;=]+\s+{name}\s*=\s*([^;]+);", text)
    assert match, f"Missing constant {name} in {path}"
    return match.group(1).strip()


def calculate_crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def test_lora_packet_header_matches_base_station() -> None:
    main_packet_header = (MAIN_ESP32_ROOT / "src" / "LoraPacket.h").read_text(encoding="utf-8")
    base_packet_header = (BASE_STATION_ROOT / "src" / "LoraPacket.h").read_text(encoding="utf-8")
    assert "kLoraPacketPayloadSize = 65;" in main_packet_header
    assert "kLoraPacketPayloadSize = 65;" in base_packet_header
    assert "kLoraPacketMagic = 0xAA;" in main_packet_header
    assert "kLoraPacketMagic = 0xAA;" in base_packet_header


def test_base_station_config_parameters() -> None:
    config_path = BASE_STATION_ROOT / "src" / "BaseStationConfig.h"
    assert _header_value(config_path, "kLoraFrequency") == "433E6"
    assert _header_value(config_path, "kLoraBandwidth") == "250E3"
    assert _header_value(config_path, "kLoraSpreadingFactor") == "7"
    assert _header_value(config_path, "kLoraCodingRate") == "5"
    assert _header_value(config_path, "kLoraSyncWord") == "0x12"
    assert _header_value(config_path, "kMaxTrackedNodes") == "2"
    assert _header_value(config_path, "kUsbSerialBaud") == "115200"


def test_lora_packet_struct_packing_and_crc() -> None:
    # 65 bytes packed binary format:
    # B (magic), B (node_id), H (seq), I (timestamp_ms)
    # 5h (ranges), 2b (angles)
    # 3h (accel), 3h (gyro)
    # h (temp), H (pressure), h (rel_alt)
    # i (lat), i (lon), h (alt), H (speed), H (course), B (fix), B (sats)
    # i (weight), B (weight_status)
    # B (estop_state), B (estop_cut), h (nearest_mm)
    # H (crc16)
    fmt = "<BBHI5h2b3h3hhHhiihHHBB iB BBhH"
    assert struct.calcsize(fmt) == 65

    raw_payload = struct.pack(
        fmt,
        0xAA,           # magic
        1,              # node_id (DUMPER_01)
        42,             # seq
        18200,          # timestamp_ms
        1260, 620, 930, 440, 510,  # 5 ranges
        -30, 25,        # 2 angles
        20, -10, 981,   # accel mg
        10, 20, 130,    # gyro dps x10
        3140, 10072, 12, # env
        129715980, 775945620, 920, 150, 4500, 3, 8, # gps
        2500, 2,        # weight 2500g, healthy
        0, 0, 1260,     # estop safe, no cut, nearest 1.26m
        0,              # crc placeholder
    )
    crc = calculate_crc16(raw_payload[:63])
    stamped = raw_payload[:63] + struct.pack("<H", crc)
    assert len(stamped) == 65
    assert calculate_crc16(stamped[:63]) == crc


def test_base_station_emitted_json_is_valid_fogsen_packet() -> None:
    sample_json = (
        '{"type":"telemetry","schema":"fogsen.main.v1","fw":"0.2.0","mode":"LIVE",'
        '"seq":42,"ms":18200,"vehicle_id":"DUMPER_01","node_id":1,'
        '"front":{"state":"HEALTHY","age":0,"seq":42,"node_ms":18200,"a":-30,"scan":1260,"scan_age":0,"front":620,"front_age":0,"ok":11,"drop":0,"ooo":0,"bad":0,"reboot":0},'
        '"rear":{"state":"HEALTHY","age":0,"seq":42,"node_ms":18200,"a":25,"scan":930,"scan_age":0,"left":440,"left_age":0,"right":510,"right_age":0,"ok":15,"drop":0,"ooo":0,"bad":0,"reboot":0},'
        '"imu":{"state":"HEALTHY","age":0,"ax":0.2,"ay":-0.1,"az":9.81,"gx":1.0,"gy":2.0,"gz":13.0,"err":0},'
        '"env":{"state":"HEALTHY","age":0,"temp":31.4,"pressure":1007.2,"rel_alt":1.2,"baseline":1,"err":0},'
        '"wheel":{"enabled":0,"l":0,"r":0,"ls":0,"rs":0,"speed":1.5},'
        '"estop":{"state":"SAFE","reason":"CLEAR","direction":"FORWARD","coverage":1,"output_enabled":0,"cut_requested":0,"cut":0,"latched":0,"nearest":1.26,"warn":0.75,"critical":0.45,"stop":0.22,"latched_ms":0},'
        '"gps":{"state":"FIX_3D","fix":1,"sats":8,"lat":12.971598,"lon":77.594562,"alt":920.0,"speed":1.5,"course":45.0},'
        '"loadcell":{"state":"HEALTHY","weight_g":2500,"weight_kg":2.5,"ok":1},'
        '"lora":{"node_id":1,"rssi":-65,"snr":9.5,"rx_count":42,"drop_count":0,"rate_hz":10.0},'
        '"system":{"tx_drop":0,"json_drop":0,"cmd_overflow":0}}'
    )
    packet = parse_main_packet(sample_json)
    assert packet.vehicle_id == "DUMPER_01"
    assert packet.node_id == 1
    assert packet.gps.fix == 1
    assert packet.loadcell.weight_kg == 2.5
    assert packet.lora.rssi == -65

    live_sample = translate_main_packet(packet, received_at_ms=19000)
    assert len(live_sample.ranges) == 5
    assert live_sample.ranges[0].range_m == pytest.approx(1.26)
    assert live_sample.emergency.state == "SAFE"
