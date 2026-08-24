from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from backend.app.models import EnvironmentState, RangeReading, VehiclePose


@dataclass(frozen=True, slots=True)
class OdometrySample:
    timestamp_ms: int
    left_distance_m: float
    right_distance_m: float
    confidence: float


@dataclass(frozen=True, slots=True)
class CameraSample:
    timestamp_ms: int
    frame_id: str
    source_uri: str | None
    visibility_score: float


@dataclass(frozen=True, slots=True)
class RadarDetection:
    timestamp_ms: int
    detection_id: str
    range_m: float
    bearing_deg: float
    relative_velocity_mps: float
    confidence: float


class RangeSensorProvider(ABC):
    @abstractmethod
    async def read_ranges(self) -> list[RangeReading]:
        """Return timestamped ranges using the canonical data contract."""


class AbsolutePositionProvider(ABC):
    @abstractmethod
    async def read_pose(self) -> VehiclePose:
        """Return an absolute pose without exposing provider-specific details."""


class OdometryProvider(ABC):
    @abstractmethod
    async def read_odometry(self) -> OdometrySample:
        """Return cumulative wheel travel."""


class CameraProvider(ABC):
    @abstractmethod
    async def read_camera(self) -> CameraSample:
        """Return camera metadata or a live/replay source reference."""


class EnvironmentProvider(ABC):
    @abstractmethod
    async def read_environment(self) -> EnvironmentState:
        """Return normalized pressure, temperature, altitude, and visibility."""


class RadarProvider(ABC):
    @abstractmethod
    async def read_radar(self) -> list[RadarDetection]:
        """Return radar detections. V1 live hardware may return no detections."""


class EmergencyStopOutput(ABC):
    @abstractmethod
    async def set_motor_cut(self, active: bool, reason: str) -> None:
        """Request or release the hardware-abstracted motor cut."""

