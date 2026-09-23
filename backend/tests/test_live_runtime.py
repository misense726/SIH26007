from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import PROJECT_ROOT, RuntimeSettings
from backend.app.main import create_app
from backend.app.providers.redundant_reader import (
    RedundantTelemetryReader,
    TelemetrySource,
)
from backend.app.providers.serial_protocol import MainTelemetryPacket, parse_main_packet


LIVE_PACKET = (
    '{"type":"telemetry","seq":18,"ms":18200,'
    '"front":{"state":"HEALTHY","age":4,"a":-30,"scan":1260,'
    '"scan_age":5,"front":620,"front_age":7,"ok":11},'
    '"rear":{"state":"HEALTHY","age":8,"a":25,"scan":930,'
    '"scan_age":9,"left":440,"left_age":10,"right":510,'
    '"right_age":11,"ok":15},'
    '"imu":{"state":"HEALTHY","age":3,"gz":1.3,"heading":12.5},'
    '"env":{"state":"HEALTHY","age":90,"temp":31.4,'
    '"pressure":1007.2,"rel_alt":1.2},'
    '"wheel":{"l":124,"r":127,"speed":0.31,"left_m":1.2,'
    '"right_m":1.23},'
    '"estop":{"state":"SAFE","cut":false,"nearest":1.26,'
    '"critical":0.45}}'
)


class OnePacketThenSilence:
    def __init__(self, port: str, baud: int) -> None:
        self._port = port
        self.baud = baud
        self.closed = False
        self._packets = [parse_main_packet(LIVE_PACKET)]

    @property
    def port(self) -> str:
        return self._port

    def poll(self) -> list[MainTelemetryPacket]:
        packets, self._packets = self._packets, []
        return packets

    def close(self) -> None:
        self.closed = True


class RepeatedPacket(OnePacketThenSilence):
    def __init__(self, port: str, baud: int) -> None:
        super().__init__(port, baud)
        self._packet = parse_main_packet(LIVE_PACKET)

    def poll(self) -> list[MainTelemetryPacket]:
        return [self._packet]


class RebootPacketSequence(OnePacketThenSilence):
    def __init__(self, port: str, baud: int) -> None:
        super().__init__(port, baud)
        first = parse_main_packet(LIVE_PACKET)
        second = first.model_copy(deep=True)
        second.seq = 19
        second.ms = 18_300
        second.wheel.left_m = 1.3
        second.wheel.right_m = 1.33

        out_of_order = first.model_copy(deep=True)
        out_of_order.front.scan = 400

        reboot = first.model_copy(deep=True)
        reboot.seq = 0
        reboot.ms = 25
        reboot.front.scan = 500
        reboot.wheel.left_m = 0.01
        reboot.wheel.right_m = 0.01
        self._packets = [first, second, out_of_order, reboot]


def live_settings(**updates: object) -> RuntimeSettings:
    values = {
        "config_dir": Path(PROJECT_ROOT / "config"),
        "runtime_mode": "LIVE",
        "serial_port": "COM42",
        "serial_stale_ms": 250,
        "serial_poll_interval_ms": 5,
        "serial_reconnect_ms": 50,
    }
    values.update(updates)
    return RuntimeSettings(**values)


def wait_for_world(client: TestClient, predicate, timeout_s: float = 2.0) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        world = client.get("/api/world").json()
        if predicate(world):
            return world
        time.sleep(0.01)
    raise AssertionError("Timed out waiting for the expected LIVE world state")


def test_simulation_is_the_default_and_live_requires_an_explicit_port() -> None:
    assert RuntimeSettings().runtime_mode == "SIMULATED"
    with pytest.raises(ValueError, match="FOGSEN_SERIAL_PORT"):
        RuntimeSettings(runtime_mode="LIVE")

    with pytest.raises(ValueError, match="FOGSEN_SERIAL_PORT"):
        RuntimeSettings(runtime_mode="LIVE", telemetry_transport="BOTH")


def test_wifi_live_mode_uses_listener_without_claiming_a_serial_port() -> None:
    settings = live_settings(
        telemetry_transport="WIFI",
        serial_port=None,
        wifi_listen_host="127.0.0.1",
        wifi_listen_port=8765,
    )
    readers: list[OnePacketThenSilence] = []

    def factory(port: str, baud: int) -> OnePacketThenSilence:
        reader = OnePacketThenSilence(port, baud)
        readers.append(reader)
        return reader

    app = create_app(settings, serial_factory=factory)
    with TestClient(app) as client:
        wait_for_world(
            client,
            lambda world: all(reading["is_valid"] for reading in world["ranges"]),
        )
        status = client.get("/api/status").json()
        assert status["telemetry_transport"] == "WIFI"
        assert status["telemetry_endpoint"] == "127.0.0.1:8765"
        assert status["serial_port"] is None

    assert readers[0].closed is True


def test_both_mode_reports_usb_and_wifi_as_one_live_source() -> None:
    readers: list[RepeatedPacket] = []
    opened_endpoints: list[str] = []

    def factory(endpoint: str, baud: int) -> RedundantTelemetryReader:
        opened_endpoints.append(endpoint)
        usb = RepeatedPacket("COM42", baud)
        wifi = RepeatedPacket("0.0.0.0:8765", baud)
        readers.extend((usb, wifi))
        return RedundantTelemetryReader(
            (
                TelemetrySource("USB", "COM42", lambda: usb),
                TelemetrySource("Wi-Fi", "0.0.0.0:8765", lambda: wifi),
            )
        )

    settings = live_settings(
        telemetry_transport="BOTH",
        wifi_listen_host="0.0.0.0",
        wifi_listen_port=8765,
    )
    app = create_app(settings, serial_factory=factory)
    with TestClient(app) as client:
        wait_for_world(
            client,
            lambda world: all(reading["is_valid"] for reading in world["ranges"]),
        )
        status = client.get("/api/status").json()
        assert status["telemetry_transport"] == "BOTH"
        assert status["telemetry_endpoint"] == "USB COM42 + WIFI 0.0.0.0:8765"
        assert status["serial_port"] == "COM42"
        assert status["active_telemetry_sources"] == ["USB", "Wi-Fi"]

    assert opened_endpoints == ["USB COM42 + WIFI 0.0.0.0:8765"]
    assert all(reader.closed for reader in readers)


def test_live_serial_packet_reaches_api_websocket_and_then_fails_stale() -> None:
    readers: list[OnePacketThenSilence] = []

    def factory(port: str, baud: int) -> OnePacketThenSilence:
        reader = OnePacketThenSilence(port, baud)
        readers.append(reader)
        return reader

    app = create_app(live_settings(), serial_factory=factory)
    with TestClient(app) as client:
        live = wait_for_world(
            client,
            lambda world: world["mode"] == "LIVE"
            and all(reading["is_valid"] for reading in world["ranges"]),
        )
        assert [reading["sensor_id"] for reading in live["ranges"]] == [
            "front_scanner",
            "front_fixed",
            "rear_scanner",
            "left_side",
            "right_side",
        ]
        assert [health["sensor_id"] for health in live["sensor_health"]] == [
            "front_scanner",
            "front_fixed",
            "rear_scanner",
            "left_side",
            "right_side",
            "mpu6050",
            "bmp280",
        ]
        assert live["safe_corridor"]["state"] == "GREY"
        assert live["vehicles"][0]["position_confidence"] == 0.0
        # Local surrounding returns remain available without absolute localization.
        assert {point["source_sensor_id"] for point in live["spatial_points"]} == {
            reading["sensor_id"] for reading in live["ranges"]
        }
        live_sequence = live["sequence"]
        live_motion_timestamp = live["motion"]["timestamp_ms"]
        live_pose_timestamp = live["vehicles"][0]["timestamp_ms"]

        status = client.get("/api/status").json()
        assert status["mode"] == "LIVE"
        assert status["status"] == "ok"
        assert status["serial_port"] == "COM42"
        assert status["last_telemetry_ms"] is not None
        assert client.get("/api/simulation").status_code == 409
        assert client.get("/api/map").status_code == 200

        with client.websocket_connect("/ws/telemetry") as socket:
            websocket_world = socket.receive_json()
            assert websocket_world["mode"] == "LIVE"
            assert len(websocket_world["ranges"]) == 5

        stale = wait_for_world(
            client,
            lambda world: world["sequence"] > live_sequence
            and all(
                health["status"] == "STALE"
                for health in world["sensor_health"][:5]
            ),
        )
        assert all(not reading["is_valid"] for reading in stale["ranges"])
        assert all(reading["range_m"] == 0.0 for reading in stale["ranges"])
        assert all(reading["quality"] == 0.0 for reading in stale["ranges"])
        assert stale["safe_corridor"]["state"] == "GREY"
        assert stale["emergency"]["state"] == "WARNING"
        assert stale["motion"]["timestamp_ms"] == live_motion_timestamp
        assert stale["motion"]["aruco_visible"] is False
        assert stale["motion"]["localization_confidence"] == 0.0
        assert stale["motion"]["imu_yaw_rate_dps"] == 0.0
        assert stale["motion"]["provider_confidence"] == {
            "hall_odometry": 0.0,
            "imu": 0.0,
            "aruco": 0.0,
        }
        assert stale["vehicles"][0]["timestamp_ms"] == live_pose_timestamp
        assert client.get("/api/health").json()["status"] == "degraded"
        assert client.get("/api/status").json()["status"] == "degraded"

    assert len(readers) == 1
    assert readers[0].closed is True


def test_repeated_main_packet_cannot_keep_live_state_fresh() -> None:
    readers: list[RepeatedPacket] = []

    def factory(port: str, baud: int) -> RepeatedPacket:
        reader = RepeatedPacket(port, baud)
        readers.append(reader)
        return reader

    app = create_app(
        live_settings(serial_stale_ms=120),
        serial_factory=factory,
    )
    with TestClient(app) as client:
        live = wait_for_world(
            client,
            lambda world: all(reading["is_valid"] for reading in world["ranges"]),
        )
        live_sequence = live["sequence"]
        stale = wait_for_world(
            client,
            lambda world: world["sequence"] > live_sequence
            and world["sensor_health"][0]["status"] == "STALE",
        )
        assert all(not reading["is_valid"] for reading in stale["ranges"])
        assert stale["safe_corridor"]["state"] == "GREY"

    assert readers[0].closed is True


def test_controller_reboot_is_accepted_without_reusing_old_wheel_baseline() -> None:
    readers: list[RebootPacketSequence] = []

    def factory(port: str, baud: int) -> RebootPacketSequence:
        reader = RebootPacketSequence(port, baud)
        readers.append(reader)
        return reader

    app = create_app(
        live_settings(serial_stale_ms=1_000),
        serial_factory=factory,
    )
    with TestClient(app) as client:
        rebooted = wait_for_world(
            client,
            lambda world: world["ranges"][0]["range_m"] == 0.5,
        )
        assert rebooted["sequence"] == 4
        pose = rebooted["vehicles"][0]
        assert (pose["x_m"] ** 2 + pose["y_m"] ** 2) ** 0.5 < 0.2

    assert readers[0].closed is True


def test_live_mode_starts_degraded_when_the_serial_port_cannot_open() -> None:
    def failing_factory(port: str, baud: int) -> OnePacketThenSilence:
        raise OSError("device is not connected")

    app = create_app(live_settings(), serial_factory=failing_factory)
    with TestClient(app) as client:
        world = wait_for_world(
            client,
            lambda state: "Could not open MAIN serial port"
            in state["sensor_health"][0]["detail"],
        )
        assert world["mode"] == "LIVE"
        assert len(world["ranges"]) == 5
        assert all(not reading["is_valid"] for reading in world["ranges"])
        assert all(
            health["status"] == "OFFLINE" for health in world["sensor_health"]
        )
        assert world["safe_corridor"]["state"] == "GREY"
        assert world["emergency"]["state"] == "WARNING"
        assert client.get("/api/health").json()["status"] == "degraded"
        status = client.get("/api/status").json()
        assert status["mode"] == "LIVE"
        assert "Could not open MAIN serial port COM42" in status["runtime_detail"]
