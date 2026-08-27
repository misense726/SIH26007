from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import PROJECT_ROOT, RuntimeSettings, load_yaml
from backend.app.main import create_app
from backend.app.models import DataMode, RangeReading, WorldState


def test_config_loader_reads_vehicle_configuration() -> None:
    settings = RuntimeSettings(config_dir=PROJECT_ROOT / "config")
    config = load_yaml("vehicle.yaml", settings)
    assert config["vehicle"]["id"] == "DUMPER_01"
    assert config["frames"]["vehicle"]["y_axis"] == "forward"


def test_sensor_configuration_matches_the_five_tof_layout() -> None:
    settings = RuntimeSettings(config_dir=PROJECT_ROOT / "config")
    config = load_yaml("sensors.yaml", settings)
    expected_ids = [
        "front_scanner",
        "front_fixed",
        "rear_scanner",
        "left_side",
        "right_side",
    ]
    assert config["acquisition"]["sequence"] == expected_ids
    assert set(config["sensors"]) == set(expected_ids)
    assert config["sensors"]["front_fixed"] == {
        "type": "VL53L0X",
        "position_m": [0.0, 0.55],
        "orientation_deg": 0.0,
        "pitch_deg": -50.0,
        "range_offset_m": 0.0,
        "max_range_m": 2.0,
    }
    assert config["sensors"]["front_scanner"]["position_m"] == [0.0, 0.32]
    assert config["sensors"]["front_scanner"]["pitch_deg"] == 0.0
    assert config["sensors"]["rear_scanner"]["position_m"] == [0.0, -0.55]
    assert config["sensors"]["rear_scanner"]["pitch_deg"] == 0.0
    assert config["sensors"]["left_side"]["position_m"] == [-0.36, 0.0]
    assert config["sensors"]["right_side"]["position_m"] == [0.36, 0.0]
    assert config["sensors"]["left_side"]["pitch_deg"] == -50.0
    assert config["sensors"]["right_side"]["pitch_deg"] == -50.0


def test_contract_rejects_unknown_fields() -> None:
    payload = {
        "sensor_id": "front_scanner",
        "range_m": 1.2,
        "unexpected": True,
    }
    try:
        RangeReading.model_validate(payload)
    except ValueError:
        pass
    else:
        raise AssertionError("RangeReading accepted an unknown field")


def test_default_world_is_explicitly_simulated() -> None:
    state = WorldState()
    assert state.mode is DataMode.SIMULATED
    assert state.primary_vehicle().mode is DataMode.SIMULATED


def test_health_status_world_and_websocket() -> None:
    app = create_app(RuntimeSettings(config_dir=Path(PROJECT_ROOT / "config"), telemetry_hz=20))
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok", "service": "fogsen-backend"}

        status = client.get("/api/status")
        assert status.status_code == 200
        assert status.json()["mode"] == "SIMULATED"

        world = client.get("/api/world")
        assert world.status_code == 200
        assert world.json()["vehicles"][0]["vehicle_id"] == "DUMPER_01"

        with client.websocket_connect("/ws/telemetry") as socket:
            telemetry = socket.receive_json()
            assert telemetry["schema_version"] == "1.0"
            assert telemetry["mode"] == "SIMULATED"
            assert len(telemetry["ranges"]) == 5
            assert telemetry["reference_map"]["map_id"] == "FOGSEN_TEST_ROUTE_01"
