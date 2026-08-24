from __future__ import annotations

import asyncio
import math
from contextlib import suppress
from pathlib import Path

from backend.app.localization.fusion import LocalizationFusion
from backend.app.mapping.occupancy import OccupancyAccumulator
from backend.app.mapping.transforms import transforms_from_config
from backend.app.models import (
    AlertEvent,
    CameraState,
    DataMode,
    EmergencyLevel,
    MapFeatureType,
    MotionState,
    Point2D,
    RecordingState,
    ReferenceMap,
    SensorHealth,
    SimulationScenario,
    SimulationState,
    VehiclePose,
    WorldState,
)
from backend.app.models.telemetry import now_ms
from backend.app.perception.change_detection import ChangeDetector
from backend.app.safety.corridor import CorridorEvaluator
from backend.app.safety.emergency import EmergencyController, SafetyParameters
from backend.app.simulation.providers import (
    SimulatedAbsolutePositionProvider,
    SimulatedCameraProvider,
    SimulatedEmergencyStopOutput,
    SimulatedEnvironmentProvider,
    SimulatedIMUProvider,
    SimulatedOdometryProvider,
    SimulatedRadarProvider,
    SimulatedRangeSensorProvider,
    SimulatedScene,
    radar_models,
)
from backend.app.twin.map_store import load_reference_map, save_reference_map
from backend.app.twin.route import PolylineRoute
from backend.app.twin.world_store import WorldStore


class FullSimulator:
    """Deterministic provider-driven simulator for the complete FogSen V1 chain."""

    def __init__(
        self,
        store: WorldStore,
        config: dict,
        telemetry_hz: float = 10.0,
    ) -> None:
        self._store = store
        self._config = config
        self._interval_s = 1.0 / telemetry_hz
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._movement_running = True
        self._speed_scale = 1.0
        self._route_distance_m = 0.0
        self._scanner_angle_deg = -80.0
        self._scanner_direction = 1.0
        self._last_heading_deg = 0.0
        self._visibility_target = float(config["demo"]["demo"]["default_visibility_score"])
        demo = config["demo"]["demo"]
        self._obstacle_enabled = bool(demo["obstacle_enabled"])
        self._obstacle_position = Point2D(
            x_m=float(demo["obstacle_position_m"][0]),
            y_m=float(demo["obstacle_position_m"][1]),
        )
        self._default_obstacle_position = self._obstacle_position.model_copy()
        self._obstacle_radius_m = 0.38
        self._scenario = (
            SimulationScenario.OBSTACLE if self._obstacle_enabled else SimulationScenario.NORMAL
        )
        self._alerts: list[AlertEvent] = []
        self._last_emergency_level = EmergencyLevel.SAFE
        self._map_path = Path(demo["map_file"])
        self._reference_map = load_reference_map(self._map_path)
        self._route_speed_mps = float(demo["route_speed_mps"])
        self._recording_state = RecordingState()

        initial_route = self._build_route(self._reference_map)
        self._route = initial_route
        initial_sample = self._route.sample(0.0)
        initial_pose = VehiclePose(
            x_m=initial_sample.x_m,
            y_m=initial_sample.y_m,
            heading_deg=initial_sample.heading_deg,
            speed_mps=0.0,
        )
        self._scene = SimulatedScene(
            timestamp_ms=now_ms(),
            pose=initial_pose,
            speed_mps=0.0,
            route_distance_m=0.0,
            yaw_rate_dps=0.0,
            visibility_target=self._visibility_target,
            obstacle_enabled=self._obstacle_enabled,
            obstacle_position=self._obstacle_position,
            obstacle_radius_m=self._obstacle_radius_m,
            front_scanner_angle_deg=self._scanner_angle_deg,
            rear_scanner_angle_deg=-self._scanner_angle_deg,
        )
        self._configure_pipeline()

    def _build_route(self, reference_map: ReferenceMap) -> PolylineRoute:
        route_feature = reference_map.feature(MapFeatureType.ROUTE)
        if route_feature is None:
            raise ValueError("Reference map does not contain a ROUTE feature")
        return PolylineRoute(route_feature.points)

    def _configure_pipeline(self) -> None:
        sensors = self._config["sensors"]
        vehicle = self._config["vehicle"]["vehicle"]
        safety_config = self._config["safety"]
        safety_values = safety_config["safety"]
        self.range_provider = SimulatedRangeSensorProvider(
            lambda: self._scene,
            sensors,
            self._reference_map,
        )
        self.absolute_provider = SimulatedAbsolutePositionProvider(lambda: self._scene)
        self.odometry_provider = SimulatedOdometryProvider(
            lambda: self._scene,
            wheel_circumference_m=float(vehicle["wheel_circumference_m"]),
            magnets_per_wheel=int(vehicle["magnets_per_wheel"]),
        )
        self.imu_provider = SimulatedIMUProvider(lambda: self._scene)
        self.camera_provider = SimulatedCameraProvider(lambda: self._scene)
        self.environment_provider = SimulatedEnvironmentProvider(lambda: self._scene)
        self.radar_provider = SimulatedRadarProvider(lambda: self._scene)
        self.emergency_output = SimulatedEmergencyStopOutput()
        self.localization = LocalizationFusion(vehicle_id=str(vehicle["id"]))
        self.occupancy = OccupancyAccumulator(
            transforms_from_config(sensors),
            resolution_m=0.25,
            origin=Point2D(x_m=0.0, y_m=0.0),
            width=80,
            height=128,
        )
        self.change_detector = ChangeDetector(self._reference_map)
        self.safety_parameters = SafetyParameters.from_config(safety_config)
        self.emergency_controller = EmergencyController(self.safety_parameters)
        self.corridor_evaluator = CorridorEvaluator(
            self._reference_map,
            road_margin_m=float(safety_values["road_margin_m"]),
            obstacle_inflation_m=float(safety_values["obstacle_inflation_m"]),
            confidence_floor=float(safety_values["confidence_floor"]),
        )

    @property
    def running(self) -> bool:
        return self._running

    @property
    def reference_map(self) -> ReferenceMap:
        return self._reference_map.model_copy(deep=True)

    async def set_reference_map(self, reference_map: ReferenceMap) -> None:
        route = self._build_route(reference_map)
        save_reference_map(reference_map, self._map_path)
        self._reference_map = reference_map.model_copy(deep=True)
        self._route = route
        self._route_distance_m = 0.0
        self._configure_pipeline()

    async def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._run(), name="fogsen-full-simulator")

    async def stop(self) -> None:
        self._running = False
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def reset(self) -> None:
        self._route_distance_m = 0.0
        self._scanner_angle_deg = -80.0
        self._scanner_direction = 1.0
        self._alerts.clear()
        self._last_emergency_level = EmergencyLevel.SAFE
        self.emergency_controller.reset()
        self.occupancy.clear()
        await self.emergency_output.set_motor_cut(False, "Simulation reset")

    async def apply_control(
        self,
        scenario: SimulationScenario | None = None,
        running: bool | None = None,
        speed_scale: float | None = None,
        obstacle_enabled: bool | None = None,
        visibility_score: float | None = None,
        reset: bool = False,
    ) -> SimulationState:
        if reset:
            await self.reset()
        if running is not None:
            self._movement_running = running
        if speed_scale is not None:
            self._speed_scale = max(0.0, min(3.0, speed_scale))
        if obstacle_enabled is not None:
            self._obstacle_enabled = obstacle_enabled
            if not obstacle_enabled:
                await self.emergency_output.set_motor_cut(False, "Obstacle removed")
                self.emergency_controller.reset()
        if visibility_score is not None:
            self._visibility_target = max(0.0, min(1.0, visibility_score))
        if scenario is not None:
            self._scenario = scenario
            await self._apply_scenario(scenario)
        return self.simulation_state()

    async def _apply_scenario(self, scenario: SimulationScenario) -> None:
        if scenario is SimulationScenario.NORMAL:
            self._visibility_target = 0.9
            self._obstacle_enabled = False
            await self.emergency_output.set_motor_cut(False, "Normal scenario")
            self.emergency_controller.reset()
        elif scenario is SimulationScenario.FOG:
            self._visibility_target = 0.18
            self._obstacle_enabled = False
            await self.emergency_output.set_motor_cut(False, "Fog scenario")
            self.emergency_controller.reset()
        elif scenario is SimulationScenario.OBSTACLE:
            self._visibility_target = 0.72
            self._obstacle_enabled = True
            self._obstacle_position = self._default_obstacle_position.model_copy()
        elif scenario is SimulationScenario.EMERGENCY:
            self._visibility_target = 0.38
            self._obstacle_enabled = True
            pose = self._scene.pose
            radians = math.radians(pose.heading_deg)
            self._obstacle_position = Point2D(
                x_m=pose.x_m + math.sin(radians) * 0.72,
                y_m=pose.y_m + math.cos(radians) * 0.72,
            )

    def simulation_state(self) -> SimulationState:
        return SimulationState(
            running=self._movement_running,
            scenario=self._scenario,
            speed_scale=self._speed_scale,
            obstacle_enabled=self._obstacle_enabled,
            front_scanner_angle_deg=self._scanner_angle_deg,
            rear_scanner_angle_deg=-self._scanner_angle_deg,
        )

    def _advance_scanners(self) -> None:
        self._scanner_angle_deg += self._scanner_direction * 10.0
        if self._scanner_angle_deg >= 80.0:
            self._scanner_angle_deg = 80.0
            self._scanner_direction = -1.0
        elif self._scanner_angle_deg <= -80.0:
            self._scanner_angle_deg = -80.0
            self._scanner_direction = 1.0

    def _append_alert(self, level: EmergencyLevel, timestamp_ms: int, reason: str | None) -> None:
        if level is self._last_emergency_level:
            return
        if level is EmergencyLevel.SAFE:
            severity = "INFO"
            title = "Safety condition cleared"
            detail = "Forward range returned to a safe threshold."
        else:
            severity = "CRITICAL" if level in {EmergencyLevel.CRITICAL, EmergencyLevel.EMERGENCY_STOP} else "WARNING"
            title = level.value.replace("_", " ").title()
            detail = reason or "Unsafe range condition detected."
        self._alerts.append(
            AlertEvent(
                event_id=f"alert-{timestamp_ms}-{level.value.lower()}",
                timestamp_ms=timestamp_ms,
                severity=severity,
                title=title,
                detail=detail,
            )
        )
        self._alerts = self._alerts[-60:]
        self._last_emergency_level = level

    async def tick(self) -> WorldState:
        timestamp = now_ms()
        speed = 0.0
        if self._movement_running and not self.emergency_output.active:
            speed = self._route_speed_mps * self._speed_scale
            self._route_distance_m += speed * self._interval_s
        route_sample = self._route.sample(self._route_distance_m)
        heading_delta = (route_sample.heading_deg - self._last_heading_deg + 180.0) % 360.0 - 180.0
        yaw_rate = heading_delta / self._interval_s
        self._last_heading_deg = route_sample.heading_deg
        ground_pose = VehiclePose(
            timestamp_ms=timestamp,
            vehicle_id="DUMPER_01",
            x_m=route_sample.x_m,
            y_m=route_sample.y_m,
            heading_deg=route_sample.heading_deg,
            speed_mps=speed,
            position_confidence=1.0,
            mode=DataMode.SIMULATED,
        )
        self._advance_scanners()
        self._scene = SimulatedScene(
            timestamp_ms=timestamp,
            pose=ground_pose,
            speed_mps=speed,
            route_distance_m=self._route_distance_m,
            yaw_rate_dps=yaw_rate,
            visibility_target=self._visibility_target,
            obstacle_enabled=self._obstacle_enabled,
            obstacle_position=self._obstacle_position,
            obstacle_radius_m=self._obstacle_radius_m,
            front_scanner_angle_deg=self._scanner_angle_deg,
            rear_scanner_angle_deg=-self._scanner_angle_deg,
            aruco_visible=(timestamp // 1000) % 23 != 0,
        )

        odometry = await self.odometry_provider.read_odometry()
        imu = await self.imu_provider.read_imu()
        try:
            absolute_pose = await self.absolute_provider.read_pose()
        except LookupError:
            absolute_pose = None
        pose = self.localization.update(
            timestamp_ms=timestamp,
            odometry=odometry,
            imu=imu,
            absolute_pose=absolute_pose,
            speed_mps=speed,
            mode=DataMode.SIMULATED,
        )
        readings = await self.range_provider.read_ranges()
        camera_sample = await self.camera_provider.read_camera()
        environment = await self.environment_provider.read_environment()
        environment = environment.model_copy(
            update={
                "visibility_score": camera_sample.visibility_score,
                "visibility_state": self._visibility_state(camera_sample.visibility_score),
            }
        )
        radar_detections = await self.radar_provider.read_radar()

        self.occupancy.add(readings, pose)
        spatial_points = self.occupancy.recent_points(timestamp)
        live_objects = self.change_detector.detect(
            spatial_points,
            pose,
            timestamp_ms=timestamp,
            mode=DataMode.SIMULATED,
        )
        sensor_health = [
            SensorHealth(
                sensor_id=reading.sensor_id,
                last_update_ms=reading.timestamp_ms,
                confidence=reading.quality,
            )
            for reading in readings
        ]
        emergency = self.emergency_controller.evaluate(timestamp, speed, readings)
        await self.emergency_output.set_motor_cut(
            emergency.motor_cut,
            emergency.reason or "Range condition safe",
        )
        self._append_alert(emergency.state, timestamp, emergency.reason)
        safety_distances = self.emergency_controller.distances(speed)
        corridor = self.corridor_evaluator.evaluate(
            pose,
            live_objects,
            sensor_health,
            emergency.nearest_obstacle_m,
            safety_distances.warning_m,
            safety_distances.critical_m,
        )
        current = await self._store.snapshot()
        return await self._store.replace(
            WorldState(
                generated_at_ms=timestamp,
                sequence=current.sequence + 1,
                mode=DataMode.SIMULATED,
                vehicles=[pose],
                reference_map=self._reference_map,
                ranges=readings,
                motion=MotionState(
                    timestamp_ms=timestamp,
                    left_hall_ticks=self.odometry_provider.ticks(),
                    right_hall_ticks=self.odometry_provider.ticks(),
                    left_distance_m=odometry.left_distance_m,
                    right_distance_m=odometry.right_distance_m,
                    imu_heading_deg=imu.heading_deg,
                    imu_yaw_rate_dps=imu.yaw_rate_dps,
                    aruco_visible=absolute_pose is not None,
                    localization_confidence=pose.position_confidence,
                    provider_confidence={
                        "hall_odometry": odometry.confidence,
                        "imu": imu.confidence,
                        "aruco": absolute_pose.position_confidence if absolute_pose else 0.0,
                    },
                ),
                camera=CameraState(
                    timestamp_ms=timestamp,
                    raw_frame_id=camera_sample.frame_id,
                    enhanced_frame_id=f"enhanced-{camera_sample.frame_id}",
                    raw_available=True,
                    enhancement_available=True,
                    metrics=self.camera_provider.last_metrics,
                ),
                environment=environment,
                live_objects=live_objects,
                radar_objects=radar_models(radar_detections, DataMode.SIMULATED),
                emergency=emergency,
                sensor_health=sensor_health,
                safe_corridor=corridor,
                spatial_points=spatial_points[-600:],
                occupancy=self.occupancy.state(timestamp),
                alerts=list(self._alerts),
                recording=self._recording_state,
                simulation=self.simulation_state(),
            )
        )

    @staticmethod
    def _visibility_state(score: float):
        from backend.app.visibility.metrics import visibility_state

        return visibility_state(score)

    async def _run(self) -> None:
        while self._running:
            started = asyncio.get_running_loop().time()
            await self.tick()
            elapsed = asyncio.get_running_loop().time() - started
            await asyncio.sleep(max(0.0, self._interval_s - elapsed))
