from __future__ import annotations

import socket
import time

from backend.app.providers.wifi_listener import WifiTelemetryListener
from backend.tests.test_live_runtime import LIVE_PACKET


def test_wifi_listener_accepts_fragmented_ndjson_and_rejects_bad_lines() -> None:
    listener = WifiTelemetryListener("127.0.0.1", 0)
    try:
        with socket.create_connection(("127.0.0.1", listener.listen_port), timeout=1) as client:
            encoded = LIVE_PACKET.encode("utf-8")
            client.sendall(encoded[:80])
            client.sendall(encoded[80:] + b"\nnot-json\n")

        deadline = time.monotonic() + 1.0
        packets = []
        while time.monotonic() < deadline and not packets:
            packets = listener.poll()
            time.sleep(0.01)

        assert len(packets) == 1
        assert packets[0].front.scan == 1260
        assert listener.invalid_packets == 1
        assert listener.connected_clients == 0
        assert listener.port.startswith("WIFI 127.0.0.1:")
    finally:
        listener.close()


def test_wifi_listener_replaces_a_stale_main_connection() -> None:
    listener = WifiTelemetryListener("127.0.0.1", 0)
    first = socket.create_connection(("127.0.0.1", listener.listen_port), timeout=1)
    second = socket.create_connection(("127.0.0.1", listener.listen_port), timeout=1)
    try:
        second.sendall(LIVE_PACKET.encode("utf-8") + b"\n")
        deadline = time.monotonic() + 1.0
        packets = []
        while time.monotonic() < deadline and not packets:
            packets = listener.poll()
            time.sleep(0.01)
        assert len(packets) == 1
        assert listener.connected_clients == 1
        assert first.recv(1) == b""
    finally:
        first.close()
        second.close()
        listener.close()
