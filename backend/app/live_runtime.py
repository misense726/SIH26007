from __future__ import annotations

import asyncio
import math
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from backend.app.camera import CameraFeed
from backend.app.models.device import VehicleTelemetryPacket, GpsTelemetry
from backend.app.mapping.occupancy import OccupancyAccumulator
from backend.app.mapping.transforms import transforms_from_config
from backend.app.models import (
    CorridorState,
    CameraState,
    DataMode,
    EmergencyLevel,
    EmergencyState,
    MapFeatureType,
    MotionState,
    OccupancyState,
    Point2D,
    RangeReading,
    ReferenceMap,
    SensorHealth,
    SensorStatus,
    SimulationState,
    VehiclePose,
    VisibilityState,
    WorldState,
)
from backend.app.models.telemetry import now_ms
from backend.app.perception.change_detection import ChangeDetector
from backend.app.providers.serial_port import MainControllerSerial
from backend.app.providers.serial_protocol import (
    LiveSerialSample,
    MainTelemetryPacket,
    translate_main_packet,
)
from backend.app.safety.corridor import CorridorEvaluator
from backend.app.safety.emergency import EmergencyController, SafetyParameters
from backend.app.twin.map_store import load_reference_map, save_reference_map
from backend.app.twin.world_store import WorldStore
from backend.app.v2x import V2XManager


RANGE_SENSOR_IDS = (
    "front_scanner",
    "front_fixed",
    "rear_scanner",
    "left_side",
    "right_side",
)
LOCAL_SENSOR_IDS = ("mpu6050", "bmp280")


class SerialReader(Protocol):
    @property
    def port(self) -> str: ...

    def poll(self) -> list[MainTelemetryPacket]: ...

    def close(self) -> None: ...


SerialFactory = Callable[[str, int], SerialReader]


class LiveSerialRuntime:
    """Publish wired MAIN telemetry through the canonical FogSen world store."""

    def __init__(
        self,
        store: WorldStore,
        config: dict,
        port: str,
        baud: int = 115200,
        stale_timeout_ms: int = 750,
        poll_interval_ms: int = 10,
        reconnect_ms: int = 1_000,
        camera_feed: CameraFeed | None = None,
        serial_factory: SerialFactory = MainControllerSerial,
        source_name: str = "MAIN serial",
        transport: str = "SERIAL",
        reported_serial_port: str | None = None,
        v2x_manager: V2XManager | None = None,
    ) -> None:
        self._store = store
        self._config = config
        self._port = port
        self._baud = baud
        self._stale_timeout_ms = stale_timeout_ms
        self._poll_interval_s = poll_interval_ms / 1000.0
        self._reconnect_s = reconnect_ms / 1000.0
        self._serial_factory = serial_factory
        self._source_name = source_name
        self._transport = transport
        self._reported_serial_port = reported_serial_port
        self._camera_feed = camera_feed
        self._v2x_manager = v2x_manager or V2XManager()
        self._serial: SerialReader | None = None
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._control_lock = asyncio.Lock()
        self._last_telemetry_ms: int | None = None
        self._stale_published = False
        self._status = "degraded"
        self._status_detail = f"Waiting for {source_name} telemetry on {port}"
        self._last_wheel_distances: tuple[float, float] | None = None
        self._last_controller_ms: int | None = None
        self._last_packet_sequence: int | None = None
        self._last_camera_signature: tuple[object, ...] | None = None
        self._last_camera_publish_ms = 0

        demo = config["demo"]["demo"]
        self._map_path = Path(demo["map_file"])
        self._reference_map = load_reference_map(self._map_path)
        vehicle = config["vehicle"]["vehicle"]
        self._vehicle_id = str(vehicle["id"])
        self._pose = VehiclePose(
            timestamp_ms=0,
            vehicle_id=self._vehicle_id,
            position_confidence=0.0,
            mode=DataMode.LIVE,
        )
        self._configure_pipeline()

    def _configure_pipeline(self) -> None:
        sensor_config = self._config["sensors"]
        safety_config = self._config["safety"]
        safety_values = safety_config["safety"]
        self._sensor_definitions = sensor_config["sensors"]
        self.occupancy = OccupancyAccumulator(
            transforms_from_config(sensor_config),
            resolution_m=0.25,
            origin=Point2D(x_m=0.0, y_m=0.0),
            width=80,
            height=128,
        )
        self.change_detector = ChangeDetector(self._reference_map)
        self.safety_parameters = SafetyParameters.from_config(safety_config)
        self._distance_controller = EmergencyController(self.safety_parameters)
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

    @property
    def status(self) -> str:
        return self._status

    @property
    def status_detail(self) -> str:
        return self._status_detail

    @property
    def serial_port(self) -> str | None:
        return self._reported_serial_port

    @property
    def telemetry_transport(self) -> str:
        return self._transport

    @property
    def telemetry_endpoint(self) -> str:
        return self._port

    @property
    def active_telemetry_sources(self) -> list[str]:
        if self._serial is not None:
            active_sources = getattr(self._serial, "active_sources", None)
            if active_sources is not None:
                return list(active_sources)
        if (
            self._last_telemetry_ms is not None
            and now_ms() - self._last_telemetry_ms <= self._stale_timeout_ms
        ):
            return ["USB" if self._transport == "SERIAL" else self._transport]
        return []

    @property
    def telemetry_source_errors(self) -> dict[str, str]:
        if self._serial is None:
            return {}
        source_errors = getattr(self._serial, "source_errors", None)
        return dict(source_errors) if source_errors is not None else {}

    @property
    def last_telemetry_ms(self) -> int | None:
        return self._last_telemetry_ms

    async def set_reference_map(self, reference_map: ReferenceMap) -> None:
        async with self._control_lock:
            if reference_map.feature(MapFeatureType.ROUTE) is None:
                raise ValueError("Reference map does not contain a ROUTE feature")
            save_reference_map(reference_map, self._map_path)
            self._reference_map = reference_map.model_copy(deep=True)
            self._configure_pipeline()
            await self._store.update(
                lambda state: state.model_copy(
                    update={
                        "generated_at_ms": now_ms(),
                        "sequence": state.sequence + 1,
                        "reference_map": self._reference_map,
                        "spatial_points": [],
                        "live_objects": [],
                        "occupancy": self.occupancy.state(now_ms()),
                    }
                )
            )

    async def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        await self._publish_unavailable(
            SensorStatus.OFFLINE,
            f"Waiting for {self._source_name} telemetry on {self._port}",
        )
        self._task = asyncio.create_task(self._run(), name="fogsen-live-serial")

    async def stop(self) -> None:
        self._running = False
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def _run(self) -> None:
        try:
            while self._running:
                if self._serial is None:
                    try:
                        self._serial = await asyncio.to_thread(
                            self._serial_factory,
                            self._port,
                            self._baud,
                        )
                    except Exception as exc:
                        detail = (
                            f"Could not open MAIN serial port {self._port}: {exc}"
                            if self._transport == "SERIAL"
                            else f"Could not open {self._source_name} listener "
                            f"{self._port}: {exc}"
                        )
                        if detail != self._status_detail:
                            await self._publish_unavailable(
                                SensorStatus.OFFLINE,
                                detail,
                            )
                        await asyncio.sleep(self._reconnect_s)
                        continue
                    self._status = "degraded"
                    self._status_detail = (
                        f"Waiting for {self._source_name} telemetry on {self._port}"
                    )

                try:
                    packets = await asyncio.to_thread(self._serial.poll)
                except Exception as exc:
                    failure_detail = (
                        f"MAIN serial read failed on {self._port}: {exc}"
                        if self._transport == "SERIAL"
                        else f"{self._source_name} read failed on "
                        f"{self._port}: {exc}"
                    )
                    await self._publish_unavailable(
                        SensorStatus.OFFLINE,
                        failure_detail,
                    )
                    await self._close_serial()
                    await asyncio.sleep(self._reconnect_s)
                    continue

                accepted_packet = False
                for packet in packets:
                    if not self._accept_packet(packet):
                        continue
                    received_at_ms = now_ms()
                    if packet.gps is not None or packet.load is not None:
                        await self._store.accept_vehicle(VehicleTelemetryPacket(
                            vehicle_id="DUMPER_01", seq=packet.seq or 0, ms=packet.ms,
                            gps=packet.gps or GpsTelemetry(), load=packet.load,
                        ), received_at_ms)
                    sample = translate_main_packet(
                        packet,
                        received_at_ms=received_at_ms,
                        stale_timeout_ms=self._stale_timeout_ms,
                    )
                    await self._publish_sample(sample, received_at_ms)
                    accepted_packet = True

                if (
                    not accepted_packet
                    and self._last_telemetry_ms is not None
                    and now_ms() - self._last_telemetry_ms > self._stale_timeout_ms
                    and not self._stale_published
                ):
                    await self._publish_unavailable(
                        SensorStatus.STALE,
                        f"{self._source_name} telemetry exceeded "
                        f"{self._stale_timeout_ms} ms",
                    )
                    self._stale_published = True
                await self._publish_camera_update()
                await asyncio.sleep(self._poll_interval_s)
        finally:
            await self._close_serial()

    async def _close_serial(self) -> None:
        serial, self._serial = self._serial, None
        if serial is None:
            return
        with suppress(Exception):
            await asyncio.to_thread(serial.close)

    def _camera_state(self, current: CameraState) -> CameraState:
        if self._camera_feed is None:
            return current.model_copy(update={"mode": DataMode.LIVE})
        return self._camera_feed.camera_state()

    @staticmethod
    def _environment_with_camera(environment, camera: CameraState):
        if camera.raw_available and camera.visibility_score is not None:
            return environment.model_copy(
                update={
                    "visibility_score": camera.visibility_score,
                    "visibility_state": camera.visibility_state,
                    "mode": DataMode.LIVE,
                }
            )
        return environment.model_copy(
            update={
                "visibility_score": 0.0,
                "visibility_state": VisibilityState.VERY_LOW,
                "mode": DataMode.LIVE,
            }
        )

    async def _publish_camera_update(self) -> None:
        if self._camera_feed is None:
            return
        timestamp_ms = now_ms()
        if timestamp_ms - self._last_camera_publish_ms < 90:
            return
        camera = self._camera_feed.camera_state()
        signature = (
            camera.raw_frame_id,
            camera.raw_available,
            camera.stream_status,
            camera.stream_detail,
        )
        if signature == self._last_camera_signature:
            return
        async with self._control_lock:
            current = await self._store.snapshot()
            environment = self._environment_with_camera(current.environment, camera)
            await self._store.replace(
                current.model_copy(
                    update={
                        "generated_at_ms": timestamp_ms,
                        "sequence": current.sequence + 1,
                        "camera": camera,
                        "environment": environment,
                    }
                )
            )
        self._last_camera_signature = signature
        self._last_camera_publish_ms = timestamp_ms

    @staticmethod
    def _counter_advanced(current: int, previous: int) -> bool:
        delta = (current - previous) & 0xFFFFFFFF
        return 0 < delta < 0x80000000

    def _accept_packet(self, packet: MainTelemetryPacket) -> bool:
        if self._last_controller_ms is None:
            self._last_controller_ms = packet.ms
            self._last_packet_sequence = packet.seq
            return True

        controller_advanced = self._counter_advanced(
            packet.ms,
            self._last_controller_ms,
        )
        sequence_advanced = True
        if packet.seq is not None and self._last_packet_sequence is not None:
            sequence_advanced = self._counter_advanced(
                packet.seq,
                self._last_packet_sequence,
            )

        controller_rolled_back = packet.ms < self._last_controller_ms
        if packet.seq is not None and self._last_packet_sequence is not None:
            controller_reset = (
                controller_rolled_back
                and packet.seq <= 5
                and packet.seq < self._last_packet_sequence
            )
        else:
            controller_reset = (
                controller_rolled_back
                and self._last_controller_ms - packet.ms
                > max(1_000, self._stale_timeout_ms)
            )
        if not controller_reset and not (controller_advanced and sequence_advanced):
            return False

        if controller_reset:
            self._last_wheel_distances = None
            self.occupancy.clear()
        self._last_controller_ms = packet.ms
        self._last_packet_sequence = packet.seq
        return True

    def _update_pose(self, sample: LiveSerialSample, timestamp_ms: int) -> VehiclePose:
        left_m = sample.motion.left_distance_m
        right_m = sample.motion.right_distance_m
        distance_delta = 0.0
        hall_confidence = sample.motion.provider_confidence.get(
            "hall_odometry", 0.0
        )
        if hall_confidence > 0.0:
            if self._last_wheel_distances is not None:
                left_delta = left_m - self._last_wheel_distances[0]
                right_delta = right_m - self._last_wheel_distances[1]
                if left_delta >= 0.0 and right_delta >= 0.0:
                    distance_delta = (left_delta + right_delta) * 0.5
            self._last_wheel_distances = (left_m, right_m)
        else:
            self._last_wheel_distances = None

        imu_confidence = sample.motion.provider_confidence.get("imu", 0.0)
        heading_deg = (
            sample.motion.imu_heading_deg
            if imu_confidence > 0.0
            else self._pose.heading_deg
        )
        heading_radians = math.radians(heading_deg)
        self._pose = VehiclePose(
            timestamp_ms=timestamp_ms,
            vehicle_id=self._vehicle_id,
            x_m=self._pose.x_m + math.sin(heading_radians) * distance_delta,
            y_m=self._pose.y_m + math.cos(heading_radians) * distance_delta,
            heading_deg=heading_deg,
            speed_mps=sample.speed_mps,
            position_confidence=0.0,
            mode=DataMode.LIVE,
        )
        return self._pose.model_copy(deep=True)

    async def _publish_sample(
        self,
        sample: LiveSerialSample,
        received_at_ms: int,
    ) -> WorldState:
        async with self._control_lock:
            current = await self._store.snapshot()
            pose = self._update_pose(sample, received_at_ms)
            self.occupancy.add(sample.ranges, pose)
            spatial_points = self.occupancy.recent_points(received_at_ms)
            if pose.position_confidence >= self.safety_parameters.confidence_floor:
                live_objects = self.change_detector.detect(
                    spatial_points,
                    pose,
                    timestamp_ms=received_at_ms,
                    mode=DataMode.LIVE,
                )
            else:
                live_objects = []

            health_by_id = {
                health.sensor_id: health for health in sample.sensor_health
            }
            tof_health = [health_by_id[sensor_id] for sensor_id in RANGE_SENSOR_IDS]
            distances = self._distance_controller.distances(sample.speed_mps)
            corridor = self.corridor_evaluator.evaluate(
                pose,
                live_objects,
                tof_health,
                sample.emergency.nearest_obstacle_m,
                distances.warning_m,
                distances.critical_m,
            )
            all_healthy = all(
                health.status is SensorStatus.HEALTHY
                for health in sample.sensor_health
            )
            self._status = "ok" if all_healthy else "degraded"
            self._status_detail = (
                f"Receiving MAIN telemetry on {self._port}"
                if all_healthy
                else "MAIN telemetry contains degraded or stale sensor data"
            )
            self._last_telemetry_ms = received_at_ms
            self._stale_published = False

            camera = self._camera_state(current.camera)
            environment = (
                self._environment_with_camera(sample.environment, camera)
                if self._camera_feed is not None
                else sample.environment
            )
            self._v2x_manager.update_from_vehicle(
                pose,
                sample.emergency,
                corridor,
                sample.emergency.nearest_obstacle_m,
            )
            return await self._store.replace(
                WorldState(
                    generated_at_ms=received_at_ms,
                    sequence=current.sequence + 1,
                    mode=DataMode.LIVE,
                    vehicles=[pose],
                    reference_map=self._reference_map,
                    ranges=sample.ranges,
                    motion=sample.motion,
                    camera=camera,
                    environment=environment,
                    live_objects=live_objects,
                    radar_objects=[],
                    emergency=sample.emergency,
                    sensor_health=sample.sensor_health,
                    safe_corridor=corridor,
                    spatial_points=spatial_points[-600:],
                    occupancy=self.occupancy.state(received_at_ms),
                    alerts=current.alerts,
                    recording=current.recording,
                    simulation=SimulationState(running=False),
                    v2x=self._v2x_manager.snapshot(),
                )
            )

    async def _publish_unavailable(
        self,
        status: SensorStatus,
        detail: str,
    ) -> WorldState:
        async with self._control_lock:
            timestamp_ms = now_ms()
            current = await self._store.snapshot()
            previous_ranges = {
                reading.sensor_id: reading for reading in current.ranges
            }
            ranges = []
            for sensor_id in RANGE_SENSOR_IDS:
                previous = previous_ranges.get(sensor_id)
                definition = self._sensor_definitions[sensor_id]
                ranges.append(
                    RangeReading(
                        timestamp_ms=previous.timestamp_ms if previous else 0,
                        sensor_id=sensor_id,
                        angle_deg=previous.angle_deg if previous else 0.0,
                        range_m=0.0,
                        quality=0.0,
                        max_range_m=float(definition["max_range_m"]),
                        is_valid=False,
                        mode=DataMode.LIVE,
                    )
                )

            previous_health = {
                health.sensor_id: health for health in current.sensor_health
            }
            health = [
                SensorHealth(
                    sensor_id=sensor_id,
                    status=status,
                    last_update_ms=(
                        previous_health[sensor_id].last_update_ms
                        if sensor_id in previous_health
                        else 0
                    ),
                    confidence=0.0,
                    detail=detail,
                )
                for sensor_id in RANGE_SENSOR_IDS + LOCAL_SENSOR_IDS
            ]
            tof_health = health[: len(RANGE_SENSOR_IDS)]
            self.occupancy.clear()
            distances = self._distance_controller.distances(
                current.primary_vehicle().speed_mps
            )
            corridor = self.corridor_evaluator.evaluate(
                current.primary_vehicle(),
                [],
                tof_health,
                None,
                distances.warning_m,
                distances.critical_m,
            )
            corridor = corridor.model_copy(
                update={
                    "state": CorridorState.GREY,
                    "confidence": 0.0,
                    "reason": detail,
                }
            )
            if current.emergency.motor_cut:
                emergency = current.emergency.model_copy(
                    update={
                        "state": EmergencyLevel.EMERGENCY_STOP,
                        "reason": f"{detail}; last reported motor cut remains active",
                        "nearest_obstacle_m": None,
                        "confidence": 0.0,
                    }
                )
            else:
                emergency = EmergencyState(
                    state=EmergencyLevel.WARNING,
                    reason=detail,
                    critical_distance_m=distances.critical_m,
                    confidence=0.0,
                    motor_cut=False,
                )

            self._status = "degraded"
            self._status_detail = detail
            base_pose = (
                current.primary_vehicle()
                if current.mode is DataMode.LIVE
                else self._pose
            )
            if current.mode is DataMode.LIVE:
                motion = current.motion.model_copy(
                    update={
                        "aruco_visible": False,
                        "localization_confidence": 0.0,
                        "provider_confidence": {
                            "hall_odometry": 0.0,
                            "imu": 0.0,
                            "aruco": 0.0,
                        },
                        "imu_yaw_rate_dps": 0.0,
                        "mode": DataMode.LIVE,
                    }
                )
            else:
                motion = MotionState(
                    timestamp_ms=0,
                    aruco_visible=False,
                    localization_confidence=0.0,
                    provider_confidence={
                        "hall_odometry": 0.0,
                        "imu": 0.0,
                        "aruco": 0.0,
                    },
                    mode=DataMode.LIVE,
                )
            if self._camera_feed is not None:
                camera = self._camera_feed.camera_state()
                environment = self._environment_with_camera(current.environment, camera)
            else:
                camera = current.camera.model_copy(
                    update={
                        "raw_available": False,
                        "enhancement_available": False,
                        "mode": DataMode.LIVE,
                    }
                )
                environment = current.environment.model_copy(
                    update={
                        "visibility_score": 0.0,
                        "visibility_state": VisibilityState.VERY_LOW,
                        "mode": DataMode.LIVE,
                    }
                )
            return await self._store.replace(
                WorldState(
                    generated_at_ms=timestamp_ms,
                    sequence=current.sequence + 1,
                    mode=DataMode.LIVE,
                    vehicles=[
                        base_pose.model_copy(
                            update={
                                "position_confidence": 0.0,
                                "mode": DataMode.LIVE,
                            }
                        )
                    ],
                    reference_map=self._reference_map,
                    ranges=ranges,
                    motion=motion,
                    camera=camera,
                    environment=environment,
                    live_objects=[],
                    radar_objects=[],
                    emergency=emergency,
                    sensor_health=health,
                    safe_corridor=corridor,
                    spatial_points=[],
                    occupancy=OccupancyState(
                        resolution_m=self.occupancy.resolution_m,
                        origin=self.occupancy.origin,
                        width=self.occupancy.width,
                        height=self.occupancy.height,
                        occupied_cells=[],
                        updated_at_ms=timestamp_ms,
                    ),
                    alerts=current.alerts,
                    recording=current.recording,
                    simulation=SimulationState(running=False),
                    v2x=self._v2x_manager.snapshot(),
                )
            )
