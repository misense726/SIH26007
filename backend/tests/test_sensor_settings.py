from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import PROJECT_ROOT, RuntimeSettings
from backend.app.main import create_app


def _settings(tmp_path: Path) -> RuntimeSettings:
    return RuntimeSettings(
        config_dir=PROJECT_ROOT / "config",
        sensor_settings_path=tmp_path / "sensor_display.json",
        telemetry_hz=20,
    )


def test_sensor_settings_are_complete_validated_and_persisted(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        initial = client.get("/api/sensor-settings")
        assert initial.status_code == 200
        body = initial.json()
        assert [sensor["sensor_id"] for sensor in body["sensors"]] == [
            "front_scanner",
            "front_fixed",
            "rear_scanner",
            "left_side",
            "right_side",
        ]
        assert body["imu_zero"]["available"] is False
        sensors = {sensor["sensor_id"]: sensor for sensor in body["sensors"]}
        assert sensors["front_scanner"]["display_pose"] == {
            "x_m": 0.0,
            "y_m": 0.32,
            "z_m": 0.32,
            "yaw_deg": 0.0,
            "pitch_deg": 0.0,
        }
        assert sensors["front_fixed"]["display_pose"]["pitch_deg"] == -50.0
        assert sensors["left_side"]["display_pose"]["pitch_deg"] == -50.0
        assert sensors["right_side"]["display_pose"]["pitch_deg"] == -50.0
        assert sensors["rear_scanner"]["display_pose"] == {
            "x_m": 0.0,
            "y_m": -0.55,
            "z_m": 0.32,
            "yaw_deg": 180.0,
            "pitch_deg": 0.0,
        }

        update = {
            "display_pose": {
                "x_m": 0.12,
                "y_m": 0.58,
                "z_m": 0.41,
                "yaw_deg": 5.0,
                "pitch_deg": -2.0,
            },
            "alert_distance_m": 1.1,
            "visual_range_m": 4.5,
        }
        changed = client.put("/api/sensor-settings/front_scanner", json=update)
        assert changed.status_code == 200
        assert changed.json()["display_pose"] == update["display_pose"]
        assert changed.json()["scanner"] is True

        unknown = client.put("/api/sensor-settings/not-a-sensor", json=update)
        assert unknown.status_code == 422
        invalid = client.put(
            "/api/sensor-settings/front_scanner",
            json={**update, "alert_distance_m": 5.0, "visual_range_m": 4.0},
        )
        assert invalid.status_code == 422

    restarted = create_app(settings)
    with TestClient(restarted) as client:
        restored = client.get("/api/sensor-settings").json()
        front = next(
            sensor
            for sensor in restored["sensors"]
            if sensor["sensor_id"] == "front_scanner"
        )
        assert front["display_pose"] == update["display_pose"]
        assert restored["revision"] == 2
