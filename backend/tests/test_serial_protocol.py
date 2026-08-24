from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from backend.app.serial_monitor import format_main_packet
from backend.app.providers.serial_port import MainControllerSerial
from backend.app.providers.serial_protocol import (
    BoundedLineBuffer,
    WireProtocolError,
    parse_main_packet,
    translate_main_packet,
)


PACKET = (
    '{"ms":18200,"front":{"age":4,"a":-30,"scan":1260,"fl":620,"fr":710,"ok":7},'
    '"rear":{"age":8,"a":25,"scan":930,"left":440,"right":510,"ok":7},'
    '"imu":{"gz":1.3,"ax":0.02,"ay":-0.01,"heading":12.5},'
    '"env":{"temp":31.4,"pressure":1007.2,"rel_alt":1.2},'
    '"wheel":{"l":124,"r":127,"speed":0.31,"left_m":1.2,"right_m":1.23},'
    '"estop":{"state":"SAFE","cut":false,"nearest_mm":930}}'
)

FIRMWARE_PACKET = (
    '{"type":"telemetry","schema":"fogsen.main.v1","seq":18,"ms":18200,'
    '"front":{"state":"HEALTHY","age":4,"seq":42,"a":-30,"scan":1260,'
    '"fl":620,"fr":710,"ok":31},'
    '"rear":{"state":"HEALTHY","age":8,"seq":43,"a":25,"scan":930,'
    '"left":440,"right":510,"ok":31},'
    '"imu":{"state":"HEALTHY","age":3,"gz":1.3,"ax":0.02,"ay":-0.01},'
    '"env":{"state":"HEALTHY","age":90,"temp":31.4,"pressure":1007.2,'
    '"rel_alt":1.2},'
    '"wheel":{"l":124,"r":127,"ls":0.3,"rs":0.31,"speed":0.305},'
    '"estop":{"state":"SAFE","reason":"CLEAR","cut":0,"latched":0,'
    '"nearest":1.26,"critical":0.45,"latched_ms":0}}'
)

OFFLINE_FIRMWARE_PACKET = (
    '{"type":"telemetry","schema":"fogsen.main.v1","seq":1,"ms":250,'
    '"front":{"state":"OFFLINE","age":null,"a":null,"scan":-1,"fl":-1,'
    '"fr":-1,"ok":0},'
    '"rear":{"state":"STALE","age":900,"a":0,"scan":-1,"left":-1,'
    '"right":-1,"ok":31},'
    '"imu":{"state":"OFFLINE","age":null,"gz":null},'
    '"env":{"state":"INITIALIZING","age":null,"temp":null,'
    '"pressure":null,"rel_alt":null},'
    '"wheel":{"l":0,"r":0,"speed":0},'
    '"estop":{"state":"SENSOR_FAULT","reason":"RANGE_COVERAGE_FAULT",'
    '"cut":0,"latched":0,"nearest":null}}'
)


def test_bounded_buffer_handles_fragmented_usb_serial_lines() -> None:
    buffer = BoundedLineBuffer()
    assert buffer.feed(b'{"ms":1') == []
    assert buffer.feed(b'}\r\nNEXT\n') == [b'{"ms":1}', b"NEXT"]


def test_bounded_buffer_discards_the_entire_oversized_line() -> None:
    buffer = BoundedLineBuffer(maximum_bytes=4)
    assert buffer.feed(b"12345ignored\nOK\n") == [b"OK"]
    assert buffer.discarded_lines == 1


def test_main_wire_packet_translates_to_six_live_ranges() -> None:
    translated = translate_main_packet(parse_main_packet(PACKET), received_at_ms=20_000)
    assert len(translated.ranges) == 6
    assert translated.ranges[0].sensor_id == "front_scanner"
    assert translated.ranges[0].range_m == pytest.approx(1.26)
    assert translated.ranges[0].mode == "LIVE"
    assert translated.motion.left_hall_ticks == 124
    assert translated.environment.relative_altitude_m == pytest.approx(1.2)
    assert translated.emergency.state == "SAFE"


def test_built_firmware_packet_matches_the_laptop_contract() -> None:
    packet = parse_main_packet(FIRMWARE_PACKET)
    translated = translate_main_packet(packet, received_at_ms=20_000)
    assert all(reading.is_valid for reading in translated.ranges)
    assert translated.motion.left_distance_m == pytest.approx(13.64)
    assert translated.motion.right_distance_m == pytest.approx(13.97)
    assert translated.motion.imu_yaw_rate_dps == pytest.approx(1.3)
    assert translated.emergency.nearest_obstacle_m == pytest.approx(1.26)
    assert translated.emergency.critical_distance_m == pytest.approx(0.45)
    assert all(health.status == "HEALTHY" for health in translated.sensor_health)
    assert format_main_packet(packet, 20_000).endswith("SAFE cut=0")


def test_offline_firmware_fields_degrade_without_rejecting_the_line() -> None:
    translated = translate_main_packet(
        parse_main_packet(OFFLINE_FIRMWARE_PACKET), received_at_ms=20_000
    )
    assert all(not reading.is_valid for reading in translated.ranges)
    assert all(reading.range_m == 0.0 for reading in translated.ranges)
    assert all(health.status == "OFFLINE" for health in translated.sensor_health[:3])
    assert all(health.status == "STALE" for health in translated.sensor_health[3:6])
    assert translated.sensor_health[6].status == "OFFLINE"
    assert translated.sensor_health[7].status == "DEGRADED"
    assert translated.emergency.state == "WARNING"


def test_stale_node_data_is_not_reused_as_valid_range() -> None:
    packet = parse_main_packet(PACKET)
    packet.front.age = 700
    translated = translate_main_packet(packet, received_at_ms=20_000)
    assert all(not reading.is_valid for reading in translated.ranges[:3])
    assert all(health.status == "STALE" for health in translated.sensor_health[:3])


def test_malformed_or_oversized_lines_fail_closed() -> None:
    with pytest.raises(WireProtocolError):
        parse_main_packet("not json")
    with pytest.raises(WireProtocolError):
        parse_main_packet(b"x" * 4097)


def test_serial_reader_separates_events_from_telemetry(monkeypatch: pytest.MonkeyPatch) -> None:
    wire_bytes = (
        b'{"type":"boot","ms":1}\n'
        + FIRMWARE_PACKET.encode()
        + b"\n"
        + b'{"type":"command_reply","cmd":"STATUS","ok":1}\n'
        + b"not-json\n"
    )

    class FakeSerial:
        def __init__(self, **kwargs: object) -> None:
            self.port = kwargs["port"]
            self._buffer = bytearray(wire_bytes)
            self.writes: list[bytes] = []
            self.closed = False

        @property
        def in_waiting(self) -> int:
            return len(self._buffer)

        def read(self, count: int) -> bytes:
            chunk = bytes(self._buffer[:count])
            del self._buffer[:count]
            return chunk

        def write(self, value: bytes) -> int:
            self.writes.append(value)
            return len(value)

        def close(self) -> None:
            self.closed = True

    fake_module = SimpleNamespace(Serial=FakeSerial)
    monkeypatch.setitem(sys.modules, "serial", fake_module)
    reader = MainControllerSerial("COM42")

    packets = reader.poll()
    assert len(packets) == 1
    assert [event["type"] for event in reader.drain_events()] == [
        "boot",
        "command_reply",
    ]
    assert reader.event_messages == 2
    assert reader.invalid_packets == 1
    reader.send_command("status")
    assert reader._serial.writes == [b"STATUS\n"]
    reader.close()
    assert reader._serial.closed
