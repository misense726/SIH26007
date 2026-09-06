from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

from backend.app.mapping.raycasting import CircleTarget, cast_ray, reference_segments
from backend.app.mapping.transforms import SensorTransform, sensor_origin_world, transforms_from_config
from backend.app.models import (
    DataMode,
    EnvironmentState,
    MapFeatureType,
    Point2D,
    RadarObject,
    RangeReading,
    ReferenceMap,
    VehiclePose,
    VisibilityState,
)
from backend.app.providers.base import (
    AbsolutePositionProvider,
    CameraProvider,
    CameraSample,
    EmergencyStopOutput,
    EnvironmentProvider,
    IMUProvider,
    IMUSample,
    OdometryProvider,
    OdometrySample,
    RadarDetection,
    RadarProvider,
    RangeSensorProvider,
)
from backend.app.visibility.metrics import (
    synthetic_visibility_frame,
    visibility_metrics,
    visibility_state,
)


@dataclass(slots=True)
class SimulatedScene:
    timestamp_ms: int
    elapsed_s: float
    pose: VehiclePose
    speed_mps: float
    route_distance_m: float
    yaw_rate_dps: float
    visibility_target: float
    obstacle_enabled: bool
    obstacle_position: Point2D
    obstacle_radius_m: float
    front_scanner_angle_deg: float
    rear_scanner_angle_deg: float
    aruco_visible: bool = True
    traffic_targets: tuple[CircleTarget, ...] = ()


SceneGetter = Callable[[], SimulatedScene]


class SimulatedRangeSensorProvider(RangeSensorProvider):
    def __init__(
        self,
        scene: SceneGetter,
        sensor_config: dict,
        reference_map: ReferenceMap,
    ) -> None:
        self._scene = scene
        self._config = sensor_config
        self._transforms = transforms_from_config(sensor_config)
        self._segments = reference_segments(reference_map)
        acquisition = sensor_config["acquisition"]
        self._sequence = list(acquisition["sequence"])
        self._stagger_ms = int(acquisition["stagger_ms"])
        self._static_circles = []
        self.last_targets: dict[str, str | None] = {}
        for feature in reference_map.features:
            if feature.feature_type is MapFeatureType.STATIC_OBSTACLE:
                self._static_circles.append(
                    CircleTarget(
                        feature.feature_id,
                        feature.points[0],
                        float(feature.properties.get("radius_m", 0.25)),
                    )
                )

    async def read_ranges(self) -> list[RangeReading]:
        scene = self._scene()
        first_timestamp = scene.timestamp_ms - self._stagger_ms * (len(self._sequence) - 1)
        dynamic_circles = [*self._static_circles, *scene.traffic_targets]
        if scene.obstacle_enabled:
            dynamic_circles.append(
                CircleTarget("simulated-live-obstacle", scene.obstacle_position, scene.obstacle_radius_m)
            )

        readings = []
        for index, sensor_id in enumerate(self._sequence):
            definition = self._config["sensors"][sensor_id]
            transform: SensorTransform = self._transforms[sensor_id]
            if sensor_id == "front_scanner":
                sample_angle = scene.front_scanner_angle_deg
            elif sensor_id == "rear_scanner":
                sample_angle = scene.rear_scanner_angle_deg
            else:
                sample_angle = 0.0
            maximum = float(definition["max_range_m"])
            origin = sensor_origin_world(transform, scene.pose)
            world_bearing = scene.pose.heading_deg + transform.orientation_deg + sample_angle
            hit = cast_ray(origin, world_bearing, maximum, self._segments, dynamic_circles)
            self.last_targets[sensor_id] = hit.target_id
            fog_penalty = max(0.0, 0.35 - scene.visibility_target) * 0.18
            quality = max(0.7, 0.97 - fog_penalty)
            noise = 0.004 * math.sin(scene.elapsed_s * 4.7 + index * 1.37)
            readings.append(
                RangeReading(
                    timestamp_ms=first_timestamp + index * self._stagger_ms,
                    sensor_id=sensor_id,
                    angle_deg=sample_angle,
                    range_m=max(0.02, min(maximum, hit.distance_m + noise)),
                    quality=quality,
                    max_range_m=maximum,
                    is_valid=True,
                    mode=DataMode.SIMULATED,
                )
            )
        return readings


class SimulatedAbsolutePositionProvider(AbsolutePositionProvider):
    def __init__(self, scene: SceneGetter) -> None:
        self._scene = scene

    async def read_pose(self) -> VehiclePose:
        scene = self._scene()
        if not scene.aruco_visible:
            raise LookupError("Simulated ArUco marker is not visible")
        phase = scene.elapsed_s
        return scene.pose.model_copy(
            update={
                "x_m": scene.pose.x_m + 0.008 * math.sin(phase * 0.9),
                "y_m": scene.pose.y_m + 0.008 * math.cos(phase * 0.7),
                "heading_deg": (scene.pose.heading_deg + 0.18 * math.sin(phase)) % 360.0,
                "position_confidence": 0.96,
                "mode": DataMode.SIMULATED,
            }
        )


class SimulatedOdometryProvider(OdometryProvider):
    def __init__(self, scene: SceneGetter, wheel_circumference_m: float, magnets_per_wheel: int) -> None:
        self._scene = scene
        self._metres_per_tick = wheel_circumference_m / magnets_per_wheel

    async def read_odometry(self) -> OdometrySample:
        scene = self._scene()
        ticks = round(scene.route_distance_m / self._metres_per_tick)
        measured_distance = ticks * self._metres_per_tick
        return OdometrySample(
            timestamp_ms=scene.timestamp_ms,
            left_distance_m=measured_distance,
            right_distance_m=measured_distance,
            confidence=0.92,
        )

    def ticks(self) -> int:
        scene = self._scene()
        return round(scene.route_distance_m / self._metres_per_tick)


class SimulatedIMUProvider(IMUProvider):
    def __init__(self, scene: SceneGetter) -> None:
        self._scene = scene

    async def read_imu(self) -> IMUSample:
        scene = self._scene()
        return IMUSample(
            timestamp_ms=scene.timestamp_ms,
            heading_deg=(scene.pose.heading_deg + 0.3 * math.sin(scene.elapsed_s / 0.7)) % 360,
            yaw_rate_dps=scene.yaw_rate_dps,
            acceleration_mps2=0.0,
            confidence=0.93,
        )


class SimulatedCameraProvider(CameraProvider):
    def __init__(self, scene: SceneGetter) -> None:
        self._scene = scene
        self.last_metrics = visibility_metrics(synthetic_visibility_frame(0.9))
        self._metrics_target = 0.9

    async def read_camera(self) -> CameraSample:
        scene = self._scene()
        if scene.visibility_target != self._metrics_target:
            self.last_metrics = visibility_metrics(synthetic_visibility_frame(scene.visibility_target))
            self._metrics_target = scene.visibility_target
        frame_id = f"sim-camera-{scene.timestamp_ms}"
        return CameraSample(
            timestamp_ms=scene.timestamp_ms,
            frame_id=frame_id,
            source_uri=None,
            visibility_score=scene.visibility_target,
        )


class SimulatedEnvironmentProvider(EnvironmentProvider):
    def __init__(self, scene: SceneGetter, config: dict) -> None:
        self._scene = scene
        self._baseline_temperature_c = float(config["baseline_temperature_c"])
        self._temperature_variation_c = float(config["temperature_variation_c"])
        self._baseline_pressure_hpa = float(config["baseline_pressure_hpa"])
        self._relative_altitude_variation_m = float(
            config["relative_altitude_variation_m"]
        )

    async def read_environment(self) -> EnvironmentState:
        scene = self._scene()
        phase = scene.elapsed_s
        score = scene.visibility_target
        relative_altitude_m = self._relative_altitude_variation_m * math.sin(phase / 19.0)
        pressure_hpa = self._baseline_pressure_hpa * (
            1.0 - relative_altitude_m / 44330.0
        ) ** 5.255
        return EnvironmentState(
            timestamp_ms=scene.timestamp_ms,
            temperature_c=self._baseline_temperature_c
            + math.sin(phase / 17.0) * self._temperature_variation_c,
            pressure_hpa=pressure_hpa,
            relative_altitude_m=relative_altitude_m,
            visibility_score=score,
            visibility_state=visibility_state(score),
            mode=DataMode.SIMULATED,
        )


class SimulatedRadarProvider(RadarProvider):
    def __init__(self, scene: SceneGetter) -> None:
        self._scene = scene

    async def read_radar(self) -> list[RadarDetection]:
        scene = self._scene()
        if not scene.obstacle_enabled:
            return []
        dx = scene.obstacle_position.x_m - scene.pose.x_m
        dy = scene.obstacle_position.y_m - scene.pose.y_m
        distance = math.hypot(dx, dy)
        absolute_bearing = math.degrees(math.atan2(dx, dy)) % 360.0
        relative_bearing = (absolute_bearing - scene.pose.heading_deg + 180.0) % 360.0 - 180.0
        return [
            RadarDetection(
                timestamp_ms=scene.timestamp_ms,
                detection_id="simulated-radar-obstacle",
                range_m=distance,
                bearing_deg=relative_bearing,
                relative_velocity_mps=-scene.speed_mps,
                confidence=0.88,
            )
        ]


class SimulatedEmergencyStopOutput(EmergencyStopOutput):
    def __init__(self) -> None:
        self.active = False
        self.reason = ""

    async def set_motor_cut(self, active: bool, reason: str) -> None:
        self.active = active
        self.reason = reason


def radar_models(detections: list[RadarDetection], mode: DataMode) -> list[RadarObject]:
    return [
        RadarObject(
            timestamp_ms=detection.timestamp_ms,
            detection_id=detection.detection_id,
            range_m=detection.range_m,
            bearing_deg=detection.bearing_deg,
            relative_velocity_mps=detection.relative_velocity_mps,
            confidence=detection.confidence,
            mode=mode,
        )
        for detection in detections
    ]
