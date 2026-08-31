from __future__ import annotations

from backend.app.providers.redundant_reader import (
    RedundantTelemetryReader,
    TelemetrySource,
)
from backend.app.providers.serial_protocol import MainTelemetryPacket, parse_main_packet


PACKET = parse_main_packet(
    '{"type":"telemetry","seq":8,"ms":900,'
    '"front":{"state":"HEALTHY","scan":1000,"front":900},'
    '"rear":{"state":"HEALTHY","scan":1100,"left":800,"right":850},'
    '"imu":{"state":"HEALTHY"},"env":{"state":"HEALTHY"},'
    '"wheel":{"l":1,"r":1,"speed":0},'
    '"estop":{"state":"SAFE","cut":false}}'
)


class PacketReader:
    def __init__(self, endpoint: str, packets: list[MainTelemetryPacket]) -> None:
        self._endpoint = endpoint
        self._packets = packets
        self.closed = False

    @property
    def port(self) -> str:
        return self._endpoint

    def poll(self) -> list[MainTelemetryPacket]:
        packets, self._packets = self._packets, []
        return packets

    def close(self) -> None:
        self.closed = True


def test_one_failed_source_does_not_block_the_other() -> None:
    wifi = PacketReader("0.0.0.0:8765", [PACKET])

    def unavailable_usb() -> PacketReader:
        raise OSError("COM11 is busy")

    reader = RedundantTelemetryReader(
        (
            TelemetrySource("USB", "COM11", unavailable_usb),
            TelemetrySource("Wi-Fi", "0.0.0.0:8765", lambda: wifi),
        )
    )

    assert reader.poll() == [PACKET]
    assert reader.active_sources == ("Wi-Fi",)
    assert reader.source_errors == {"USB": "COM11 is busy"}

    reader.close()
    assert wifi.closed is True


def test_reader_merges_packets_and_closes_every_source() -> None:
    usb = PacketReader("COM11", [PACKET])
    wifi = PacketReader("0.0.0.0:8765", [PACKET])
    reader = RedundantTelemetryReader(
        (
            TelemetrySource("USB", "COM11", lambda: usb),
            TelemetrySource("Wi-Fi", "0.0.0.0:8765", lambda: wifi),
        )
    )

    assert reader.port == "USB COM11 + Wi-Fi 0.0.0.0:8765"
    assert reader.poll() == [PACKET, PACKET]
    assert reader.active_sources == ("USB", "Wi-Fi")

    reader.close()
    assert usb.closed is True
    assert wifi.closed is True
