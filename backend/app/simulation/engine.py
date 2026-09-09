from __future__ import annotations

import asyncio
import math
from contextlib import suppress
from pathlib import Path
from typing import TYPE_CHECKING

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
from backend.app.v2x import V2XManager
from backend.app.simulation.haul_route import HaulRun
from backend.app.mapping.raycasting import CircleTarget
from backend.app.models.v2x import V2VBasicSafetyMessage

if TYPE_CHECKING:
    from backend.app.camera import CameraFeed


class FullSimulator:
    """Deterministic provider-driven simulator for the complete FogSen V1 chain."""

    def __init__(
        self,
        store: WorldStore,
        config: dict,
        telemetry_hz: float = 10.0,
        camera_feed: CameraFeed | None = None,
        v2x_manager: V2XManager | None = None,
    ) -> None:
        self._store = store
        self._config = config
        self._camera_feed = camera_feed
        self._v2x_manager = v2x_manager or V2XManager()
        self._interval_s = 1.0 / telemetry_hz
        self._control_lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._movement_running = True
        demo = config["demo"]["demo"]
        self._default_scenario = SimulationScenario(demo["default_scenario"])
        self._speed_scale = float(demo["default_speed_scale"])
        self._route_distance_m = 0.0
        self._tick_index = 0
        self._elapsed_s = 0.0
        self._loop_dwell_s = 0.0
        self._timestamp_ms = now_ms()
        self._front_scanner_angle_deg = -80.0
        self._front_scanner_direction = 1.0
        self._rear_scanner_angle_deg = 80.0
        self._rear_scanner_direction = -1.0
        scenario_values = demo["scenarios"][self._default_scenario.value]
        self._visibility_target = float(scenario_values["visibility_score"])
        self._obstacle_enabled = bool(scenario_values["obstacle_enabled"])
        self._obstacle_position = Point2D(
            x_m=float(demo["obstacle_position_m"][0]),
            y_m=float(demo["obstacle_position_m"][1]),
        )
        self._default_obstacle_position = self._obstacle_position.model_copy()
        self._obstacle_radius_m = float(demo["obstacle_radius_m"])
        self._active_obstacle_radius_m = self._obstacle_radius_m
        self._scenario = self._default_scenario
        self._scenario_values = demo["scenarios"]
        dropout = demo["aruco_dropout"]
        self._aruco_dropout_period_ticks = int(dropout["period_ticks"])
        self._aruco_dropout_start_tick = int(dropout["start_tick"])
        self._aruco_dropout_duration_ticks = int(dropout["duration_ticks"])
        self._alerts: list[AlertEvent] = []
        self._last_emergency_level = EmergencyLevel.SAFE
        self._map_path = Path(demo["map_file"])
        self._reference_map = load_reference_map(self._map_path)
        self._base_reference_map = self._reference_map
        self._haul = (
            HaulRun(demo["haul"])
            if self._scenario is SimulationScenario.HAUL
            else None
        )
        if self._haul is not None:
            self._reference_map = self._haul.reference_map
            self._v2x_manager.clear_peers()
        self._route_speed_mps = float(demo["route_speed_mps"])
        self._max_demo_speed_mps = float(
            config["vehicle"]["vehicle"]["max_demo_speed_mps"]
        )
        self._recording_state = RecordingState()

        initial_route = self._build_route(self._reference_map)
        self._route = initial_route
        initial_sample = self._route.sample(0.0)
        self._last_heading_deg = initial_sample.heading_deg
        initial_pose = VehiclePose(
            x_m=initial_sample.x_m,
            y_m=initial_sample.y_m,
            heading_deg=initial_sample.heading_deg,
            speed_mps=0.0,
        )
        self._scene = SimulatedScene(
            timestamp_ms=self._timestamp_ms,
            elapsed_s=0.0,
            pose=initial_pose,
            speed_mps=0.0,
            route_distance_m=0.0,
            yaw_rate_dps=0.0,
            visibility_target=self._visibility_target,
            obstacle_enabled=self._obstacle_enabled,
            obstacle_position=self._obstacle_position,
            obstacle_radius_m=self._active_obstacle_radius_m,
            front_scanner_angle_deg=self._front_scanner_angle_deg,
            rear_scanner_angle_deg=self._rear_scanner_angle_deg,
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
        self.environment_provider = SimulatedEnvironmentProvider(
            lambda: self._scene,
            self._config["demo"]["demo"]["environment"],
        )
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
        async with self._control_lock:
            route = self._build_route(reference_map)
            save_reference_map(reference_map, self._map_path)
            self._reference_map = reference_map.model_copy(deep=True)
            self._base_reference_map = self._reference_map
            self._route = route
            await self._reset_unlocked()

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
        async with self._control_lock:
            await self._reset_unlocked()

    async def _reset_unlocked(self) -> None:
        self._route_distance_m = 0.0
        self._tick_index = 0
        self._elapsed_s = 0.0
        self._loop_dwell_s = 0.0
        self._timestamp_ms = now_ms()
        self._front_scanner_angle_deg = -80.0
        self._front_scanner_direction = 1.0
        self._rear_scanner_angle_deg = 80.0
        self._rear_scanner_direction = -1.0
        self._movement_running = True
        self._speed_scale = float(
            self._config["demo"]["demo"]["default_speed_scale"]
        )
        self._alerts.clear()
        self._last_emergency_level = EmergencyLevel.SAFE
        self._active_obstacle_radius_m = self._obstacle_radius_m
        initial_sample = self._route.sample(0.0)
        self._last_heading_deg = initial_sample.heading_deg
        self._scene = SimulatedScene(
            timestamp_ms=self._timestamp_ms,
            elapsed_s=0.0,
            pose=VehiclePose(
                timestamp_ms=self._timestamp_ms,
                x_m=initial_sample.x_m,
                y_m=initial_sample.y_m,
                heading_deg=initial_sample.heading_deg,
                speed_mps=0.0,
                mode=DataMode.SIMULATED,
            ),
            speed_mps=0.0,
            route_distance_m=0.0,
            yaw_rate_dps=0.0,
            visibility_target=self._visibility_target,
            obstacle_enabled=False,
            obstacle_position=self._default_obstacle_position.model_copy(),
            obstacle_radius_m=self._active_obstacle_radius_m,
            front_scanner_angle_deg=self._front_scanner_angle_deg,
            rear_scanner_angle_deg=self._rear_scanner_angle_deg,
        )
        self._configure_pipeline()
        self._v2x_manager.reset()
        self._scenario = self._default_scenario
        await self._apply_scenario(self._default_scenario)

    async def apply_control(
        self,
        scenario: SimulationScenario | None = None,
        running: bool | None = None,
        speed_scale: float | None = None,
        obstacle_enabled: bool | None = None,
        visibility_score: float | None = None,
        reset: bool = False,
    ) -> SimulationState:
        async with self._control_lock:
            return await self._apply_control_unlocked(
                scenario=scenario,
                running=running,
                speed_scale=speed_scale,
                obstacle_enabled=obstacle_enabled,
                visibility_score=visibility_score,
                reset=reset,
            )

    async def apply_control_and_tick(
        self,
        scenario: SimulationScenario | None = None,
        running: bool | None = None,
        speed_scale: float | None = None,
        obstacle_enabled: bool | None = None,
        visibility_score: float | None = None,
        reset: bool = False,
    ) -> WorldState:
        async with self._control_lock:
            await self._apply_control_unlocked(
                scenario=scenario,
                running=running,
                speed_scale=speed_scale,
                obstacle_enabled=obstacle_enabled,
                visibility_score=visibility_score,
                reset=reset,
            )
            return await self._tick_once()

    async def _apply_control_unlocked(
        self,
        scenario: SimulationScenario | None,
        running: bool | None,
        speed_scale: float | None,
        obstacle_enabled: bool | None,
        visibility_score: float | None,
        reset: bool,
    ) -> SimulationState:
        if reset:
            await self._reset_unlocked()
        if scenario is not None:
            self._scenario = scenario
            await self._apply_scenario(scenario)
        if running is not None:
            self._movement_running = running
        if speed_scale is not None:
            self._speed_scale = max(0.0, min(3.0, speed_scale))
        if obstacle_enabled is not None:
            if self._obstacle_enabled != obstacle_enabled:
                self.occupancy.clear()
            self._obstacle_enabled = obstacle_enabled
            if not obstacle_enabled:
                await self.emergency_output.set_motor_cut(False, "Obstacle removed")
                self.emergency_controller.reset()
        if visibility_score is not None:
            self._visibility_target = max(0.0, min(1.0, visibility_score))
        return self.simulation_state()

    async def _apply_scenario(self, scenario: SimulationScenario) -> None:
        change_map = (scenario is SimulationScenario.HAUL) != (self._haul is not None)
        if scenario is SimulationScenario.HAUL:
            self._haul = HaulRun(self._config["demo"]["demo"]["haul"])
            self._reference_map = self._haul.reference_map
            self._v2x_manager.clear_peers()
        else:
            self._haul = None
            self._reference_map = self._base_reference_map
        if change_map or scenario is SimulationScenario.HAUL:
            self._route = self._build_route(self._reference_map)
            self._route_distance_m = 0.0
            self._last_heading_deg = self._route.sample(0).heading_deg
            self._configure_pipeline()
            start = self._route.sample(0)
            self._scene.pose = VehiclePose(
                timestamp_ms=self._timestamp_ms,
                x_m=start.x_m,
                y_m=start.y_m,
                heading_deg=start.heading_deg,
            )
        values = self._scenario_values[scenario.value]
        self._visibility_target = float(values["visibility_score"])
        self._obstacle_enabled = bool(values["obstacle_enabled"])
        self._obstacle_position = self._default_obstacle_position.model_copy()
        self._active_obstacle_radius_m = float(
            values.get("obstacle_radius_m", self._obstacle_radius_m)
        )
        self.occupancy.clear()
        self.emergency_controller.reset()
        await self.emergency_output.set_motor_cut(False, f"{scenario.value} scenario selected")
        if scenario is SimulationScenario.EMERGENCY:
            pose = self._scene.pose
            radians = math.radians(pose.heading_deg)
            obstacle_ahead_m = float(values["obstacle_ahead_m"])
            self._obstacle_position = Point2D(
                x_m=pose.x_m + math.sin(radians) * obstacle_ahead_m,
                y_m=pose.y_m + math.cos(radians) * obstacle_ahead_m,
            )

    def simulation_state(self) -> SimulationState:
        return SimulationState(
            running=self._movement_running,
            scenario=self._scenario,
            speed_scale=self._speed_scale,
            obstacle_enabled=self._obstacle_enabled,
            visibility_score=self._visibility_target,
            front_scanner_angle_deg=self._front_scanner_angle_deg,
            rear_scanner_angle_deg=self._rear_scanner_angle_deg,
        )

    def _advance_scanners(self) -> None:
        self._front_scanner_angle_deg += self._front_scanner_direction * 10.0
        if self._front_scanner_angle_deg >= 80.0:
            self._front_scanner_angle_deg = 80.0
            self._front_scanner_direction = -1.0
        elif self._front_scanner_angle_deg <= -80.0:
            self._front_scanner_angle_deg = -80.0
            self._front_scanner_direction = 1.0

        self._rear_scanner_angle_deg += self._rear_scanner_direction * 10.0
        if self._rear_scanner_angle_deg >= 80.0:
            self._rear_scanner_angle_deg = 80.0
            self._rear_scanner_direction = -1.0
        elif self._rear_scanner_angle_deg <= -80.0:
            self._rear_scanner_angle_deg = -80.0
            self._rear_scanner_direction = 1.0

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
        async with self._control_lock:
            return await self._tick_once()

    async def _tick_once(self) -> WorldState:
        self._tick_index += 1
        self._elapsed_s += self._interval_s
        self._timestamp_ms += round(self._interval_s * 1000.0)
        timestamp = self._timestamp_ms
        peer = None
        lead = None
        if self._haul is not None:
            if (self._movement_running and self._haul.unloaded
                    and self._haul.dwell_s >= self._haul.config["site_dwell_s"]):
                self._haul.next_cycle()
                self._route_distance_m = 0.0
                self._configure_pipeline()
            was_enabled = self._obstacle_enabled
            self._obstacle_enabled = self._haul.advance(
                self._interval_s, self._movement_running
            )
            self._obstacle_position = self._haul.obstacle_position()
            self._active_obstacle_radius_m = self._haul.config["obstacle_radius_m"]
            if was_enabled and not self._obstacle_enabled:
                self.occupancy.clear()
                self.emergency_controller.reset()
                await self.emergency_output.set_motor_cut(
                    False, "Simulated road obstruction cleared"
                )
            peer = self._haul.peer(timestamp, self._movement_running)
        speed = 0.0
        if self._movement_running and not self.emergency_output.active:
            requested_speed = min(
                (self._haul.config.get("cruise_speed_mps", self._route_speed_mps)
                 if self._haul else self._route_speed_mps) * self._speed_scale,
                self._max_demo_speed_mps,
            )
            if self._haul is not None:
                requested_speed = self._haul.speed_limit(
                    self._route_distance_m, requested_speed, self._interval_s
                )
            remaining_m = max(0.0, self._route.total_length_m - self._route_distance_m)
            travelled_m = min(requested_speed * self._interval_s, remaining_m)
            self._route_distance_m += travelled_m
            speed = travelled_m / self._interval_s
            if self._haul is None and remaining_m < 0.01:
                self._loop_dwell_s += self._interval_s
                if self._loop_dwell_s >= 2.0:
                    self._route_distance_m = 0.0
                    self._loop_dwell_s = 0.0
                    self.occupancy.clear()
                    self._alerts.clear()
                    self._last_emergency_level = EmergencyLevel.SAFE
                    self.emergency_controller.reset()
                    await self.emergency_output.set_motor_cut(
                        False, "Route cycle complete"
                    )
        route_sample = self._route.sample(self._route_distance_m)
        offset = self._haul.offset(self._route_distance_m) if self._haul else 0.0
        heading = math.radians(route_sample.heading_deg)
        vehicle_heading = route_sample.heading_deg
        if self._haul is not None:
            slope = (self._haul.offset(self._route_distance_m + 0.05)
                     - self._haul.offset(self._route_distance_m - 0.05)) / 0.1
            vehicle_heading = (vehicle_heading + math.degrees(math.atan(slope))) % 360
        heading_delta = (vehicle_heading - self._last_heading_deg + 180.0) % 360.0 - 180.0
        yaw_rate = heading_delta / self._interval_s
        self._last_heading_deg = vehicle_heading
        ground_pose = VehiclePose(
            timestamp_ms=timestamp,
            vehicle_id="DUMPER_01",
            x_m=route_sample.x_m + math.cos(heading) * offset,
            y_m=route_sample.y_m - math.sin(heading) * offset,
            heading_deg=vehicle_heading,
            speed_mps=speed,
            position_confidence=1.0,
            mode=DataMode.SIMULATED,
        )
        self._advance_scanners()
        if self._haul is not None:
            peer = self._haul.peer(timestamp, self._movement_running)
            lead = self._haul.lead(timestamp, self._movement_running)
        self._scene = SimulatedScene(
            timestamp_ms=timestamp,
            elapsed_s=self._elapsed_s,
            pose=ground_pose,
            speed_mps=speed,
            route_distance_m=self._route_distance_m,
            yaw_rate_dps=yaw_rate,
            visibility_target=self._visibility_target,
            obstacle_enabled=self._obstacle_enabled,
            obstacle_position=self._obstacle_position,
            obstacle_radius_m=self._active_obstacle_radius_m,
            front_scanner_angle_deg=self._front_scanner_angle_deg,
            rear_scanner_angle_deg=self._rear_scanner_angle_deg,
            aruco_visible=self._aruco_visible(),
            traffic_targets=(
                tuple(CircleTarget(
                    other.vehicle_id,
                    Point2D(x_m=other.x_m, y_m=other.y_m),
                    self._haul.config["peer_radius_m"],
                ) for other in (peer, lead))
                if peer is not None else ()
            ),
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
        if self._haul is not None:
            self._haul.observe(readings, self.range_provider.last_targets)
        camera_sample = await self.camera_provider.read_camera()
        camera_state = CameraState(
            timestamp_ms=timestamp,
            raw_frame_id=camera_sample.frame_id,
            enhanced_frame_id=f"enhanced-{camera_sample.frame_id}",
            raw_available=True,
            enhancement_available=True,
            metrics=self.camera_provider.last_metrics,
            visibility_score=camera_sample.visibility_score,
            visibility_state=self._visibility_state(camera_sample.visibility_score),
            stream_status="simulated",
            stream_detail="Deterministic simulated camera",
            mode=DataMode.SIMULATED,
        )
        camera_visibility_score = camera_sample.visibility_score
        if self._camera_feed is not None:
            camera_state = self._camera_feed.camera_state()
            if camera_state.raw_available and camera_state.visibility_score is not None:
                camera_visibility_score = camera_state.visibility_score
        environment = await self.environment_provider.read_environment()
        environment = environment.model_copy(
            update={
                "visibility_score": camera_visibility_score,
                "visibility_state": self._visibility_state(camera_visibility_score),
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
                detail="SIMULATED range provider",
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
        self._v2x_manager.update_from_vehicle(
            pose,
            emergency,
            corridor,
            emergency.nearest_obstacle_m,
        )
        for other in ([peer, lead] if peer is not None else []):
            self._v2x_manager.receive_bsm(
                V2VBasicSafetyMessage(
                    message_id=f"haul-{other.vehicle_id}-{timestamp}",
                    timestamp_ms=timestamp,
                    vehicle_id=other.vehicle_id,
                    x_m=other.x_m,
                    y_m=other.y_m,
                    heading_deg=other.heading_deg,
                    speed_mps=other.speed_mps,
                )
            )
        sequence = await self._store.sequence()
        return await self._store.replace(
            WorldState(
                generated_at_ms=timestamp,
                sequence=sequence + 1,
                mode=DataMode.SIMULATED,
                vehicles=[pose, peer, lead] if peer is not None else [pose],
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
                camera=camera_state,
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
                v2x=self._v2x_manager.snapshot(),
                haul_route=(
                    self._haul.snapshot(
                        self._route_distance_m, self._obstacle_enabled, emergency.motor_cut, speed
                    )
                    if self._haul is not None else None
                ),
            )
        )

    @staticmethod
    def _visibility_state(score: float):
        from backend.app.visibility.metrics import visibility_state

        return visibility_state(score)

    def _aruco_visible(self) -> bool:
        if self._aruco_dropout_duration_ticks <= 0:
            return True
        phase = self._tick_index % self._aruco_dropout_period_ticks
        return not (
            self._aruco_dropout_start_tick
            <= phase
            < self._aruco_dropout_start_tick + self._aruco_dropout_duration_ticks
        )

    async def _run(self) -> None:
        while self._running:
            started = asyncio.get_running_loop().time()
            # Keep published timestamps current after scheduler delays or system sleep.
            self._timestamp_ms = max(
                self._timestamp_ms, now_ms() - round(self._interval_s * 1000)
            )
            await self.tick()
            elapsed = asyncio.get_running_loop().time() - started
            await asyncio.sleep(max(0.0, self._interval_s - elapsed))
