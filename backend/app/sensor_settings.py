from __future__ import annotations

import json
import os
from pathlib import Path
from threading import RLock
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


SensorId = Literal[
    "front_scanner",
    "front_fixed",
    "rear_scanner",
    "left_side",
    "right_side",
]

SENSOR_ORDER: tuple[SensorId, ...] = (
    "front_scanner",
    "front_fixed",
    "rear_scanner",
    "left_side",
    "right_side",
)

SENSOR_LABELS: dict[SensorId, str] = {
    "front_scanner": "Front scanner",
    "front_fixed": "Front fixed",
    "rear_scanner": "Rear scanner",
    "left_side": "Left side",
    "right_side": "Right side",
}


class SettingsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DisplayPose(SettingsModel):
    x_m: float = Field(ge=-10.0, le=10.0)
    y_m: float = Field(ge=-10.0, le=10.0)
    z_m: float = Field(ge=-2.0, le=5.0)
    yaw_deg: float = Field(ge=-180.0, le=180.0)
    pitch_deg: float = Field(ge=-90.0, le=90.0)


class SensorDisplayUpdate(SettingsModel):
    display_pose: DisplayPose
    alert_distance_m: float = Field(ge=0.05, le=20.0)
    visual_range_m: float = Field(ge=0.1, le=20.0)

    @model_validator(mode="after")
    def alert_must_fit_visual_range(self) -> "SensorDisplayUpdate":
        if self.alert_distance_m > self.visual_range_m:
            raise ValueError("alert_distance_m cannot exceed visual_range_m")
        return self


class SensorDisplaySetting(SensorDisplayUpdate):
    sensor_id: SensorId
    label: str
    scanner: bool


class ImuZeroState(SettingsModel):
    available: bool = False
    status: Literal["READY", "ZEROING", "ZEROED", "ERROR"] = "READY"
    zeroed_at_ms: int | None = Field(default=None, ge=0)
    detail: str | None = None


class SensorSettingsState(SettingsModel):
    revision: int = Field(default=1, ge=1)
    imu_zero: ImuZeroState = Field(default_factory=ImuZeroState)
    sensors: list[SensorDisplaySetting]


class SensorSettingsStore:
    """Persist dashboard-only sensor poses and alert display ranges."""

    def __init__(self, project_config: dict, path: Path) -> None:
        self._path = path
        self._lock = RLock()
        self._state = self._defaults(project_config)
        self._load_saved()

    @staticmethod
    def _defaults(project_config: dict) -> SensorSettingsState:
        sensor_config = project_config["sensors"]["sensors"]
        warning_distance = float(
            project_config["safety"]["safety"]["stationary_warning_m"]
        )
        sensors: list[SensorDisplaySetting] = []
        for sensor_id in SENSOR_ORDER:
            configured = sensor_config[sensor_id]
            position = configured["position_m"]
            sensors.append(
                SensorDisplaySetting(
                    sensor_id=sensor_id,
                    label=SENSOR_LABELS[sensor_id],
                    scanner=sensor_id.endswith("scanner"),
                    display_pose=DisplayPose(
                        x_m=float(position[0]),
                        y_m=float(position[1]),
                        z_m=0.32,
                        yaw_deg=float(configured["orientation_deg"]),
                        pitch_deg=float(configured.get("pitch_deg", 0.0)),
                    ),
                    alert_distance_m=min(
                        warning_distance,
                        float(configured["max_range_m"]),
                    ),
                    visual_range_m=float(configured["max_range_m"]),
                )
            )
        return SensorSettingsState(sensors=sensors)

    def _load_saved(self) -> None:
        if not self._path.is_file():
            return
        try:
            saved = SensorSettingsState.model_validate_json(
                self._path.read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            return
        saved_by_id = {sensor.sensor_id: sensor for sensor in saved.sensors}
        if set(saved_by_id) != set(SENSOR_ORDER):
            return
        self._state = saved.model_copy(
            update={"sensors": [saved_by_id[sensor_id] for sensor_id in SENSOR_ORDER]},
            deep=True,
        )

    def snapshot(self) -> SensorSettingsState:
        with self._lock:
            return self._state.model_copy(deep=True)

    def update(
        self,
        sensor_id: SensorId,
        update: SensorDisplayUpdate,
    ) -> SensorDisplaySetting:
        with self._lock:
            sensors = list(self._state.sensors)
            index = next(
                (i for i, sensor in enumerate(sensors) if sensor.sensor_id == sensor_id),
                None,
            )
            if index is None:
                raise KeyError(sensor_id)
            current = sensors[index]
            sensors[index] = SensorDisplaySetting(
                sensor_id=current.sensor_id,
                label=current.label,
                scanner=current.scanner,
                **update.model_dump(),
            )
            self._state = self._state.model_copy(
                update={"revision": self._state.revision + 1, "sensors": sensors},
                deep=True,
            )
            self._persist()
            return sensors[index].model_copy(deep=True)

    def set_imu_zero(self, state: ImuZeroState) -> ImuZeroState:
        with self._lock:
            self._state = self._state.model_copy(
                update={"revision": self._state.revision + 1, "imu_zero": state},
                deep=True,
            )
            self._persist()
            return state.model_copy(deep=True)

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_suffix(f"{self._path.suffix}.tmp")
        temporary.write_text(
            self._state.model_dump_json(indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, self._path)
