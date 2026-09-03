from __future__ import annotations

import time
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.common import Point2D, TelemetryModel, now_ms
from backend.app.models.operations import MineOperationsState
from backend.app.models.v2x import V2XState


class DataMode(StrEnum):
    LIVE = "LIVE"
    SIMULATED = "SIMULATED"
    REPLAY = "REPLAY"


class VisibilityState(StrEnum):
    GOOD = "GOOD"
    MODERATE = "MODERATE"
    LOW = "LOW"
    VERY_LOW = "VERY_LOW"


class EmergencyLevel(StrEnum):
    SAFE = "SAFE"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    EMERGENCY_STOP = "EMERGENCY_STOP"


class SensorStatus(StrEnum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    STALE = "STALE"
    OFFLINE = "OFFLINE"


class MapFeatureType(StrEnum):
    ROAD = "ROAD"
    CENTERLINE = "CENTERLINE"
    BERM = "BERM"
    HAZARD_ZONE = "HAZARD_ZONE"
    ROUTE = "ROUTE"
    INTERSECTION = "INTERSECTION"
    STATIC_OBSTACLE = "STATIC_OBSTACLE"
    SPEED_ZONE = "SPEED_ZONE"
    START = "START"
    DESTINATION = "DESTINATION"


class GeometryType(StrEnum):
    POINT = "POINT"
    POLYLINE = "POLYLINE"
    POLYGON = "POLYGON"


class CorridorState(StrEnum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"
    GREY = "GREY"


class LiveObjectType(StrEnum):
    UNKNOWN_OBSTACLE = "UNKNOWN_OBSTACLE"
    MAP_MISMATCH = "MAP_MISMATCH"
    PROXIMITY = "PROXIMITY"


class ObjectSource(StrEnum):
    TOF = "TOF"
    RADAR = "RADAR"
    CAMERA = "CAMERA"
    FUSED = "FUSED"


class SimulationScenario(StrEnum):
    NORMAL = "NORMAL"
    FOG = "FOG"
    OBSTACLE = "OBSTACLE"
    EMERGENCY = "EMERGENCY"
    SCENARIO_1_DENSE_FOG = "SCENARIO_1_DENSE_FOG"
    SCENARIO_2_VEHICLE_AHEAD = "SCENARIO_2_VEHICLE_AHEAD"
    SCENARIO_3_OPPOSING_VEHICLE = "SCENARIO_3_OPPOSING_VEHICLE"
    SCENARIO_4_STATIC_OBSTACLE = "SCENARIO_4_STATIC_OBSTACLE"
    SCENARIO_5_ROAD_CLOSURE_REROUTE = "SCENARIO_5_ROAD_CLOSURE_REROUTE"
    SCENARIO_6_PAYLOAD_ROUTING = "SCENARIO_6_PAYLOAD_ROUTING"
    SCENARIO_7_FLEET_MONITORING = "SCENARIO_7_FLEET_MONITORING"
    SCENARIO_8_HAULAGE_ANALYTICS = "SCENARIO_8_HAULAGE_ANALYTICS"


class MapFeature(TelemetryModel):
    feature_id: str
    feature_type: MapFeatureType
    geometry_type: GeometryType
    points: list[Point2D] = Field(min_length=1)
    label: str
    properties: dict[str, str | float | int | bool] = Field(default_factory=dict)


class ReferenceMap(TelemetryModel):
    map_id: str
    name: str
    version: int = Field(default=1, ge=1)
    created_at_ms: int = Field(default_factory=now_ms, ge=0)
    coordinate_frame: Literal["LOCAL_CARTESIAN_METRES"] = "LOCAL_CARTESIAN_METRES"
    coordinate_frame_id: str = "LOCAL_CARTESIAN_METRES"
    source: str = "MANUAL"
    source_detail: str | None = None
    geographic_anchor: dict[str, float] | None = None
    features: list[MapFeature] = Field(default_factory=list)

    def feature(self, feature_type: MapFeatureType) -> MapFeature | None:
        return next(
            (feature for feature in self.features if feature.feature_type is feature_type),
            None,
        )

    def features_of_type(self, feature_type: MapFeatureType) -> list[MapFeature]:
        return [feature for feature in self.features if feature.feature_type is feature_type]


class SafeCorridor(TelemetryModel):
    state: CorridorState = CorridorState.GREY
    polygon: list[Point2D] = Field(default_factory=list)
    exclusions: list[MapFeature] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reason: str = "Not yet evaluated"


class SpatialPoint(TelemetryModel):
    x_m: float
    y_m: float
    height_hint_m: float = Field(default=0.0, ge=0.0)
    source_sensor_id: str
    quality: float = Field(default=1.0, ge=0.0, le=1.0)
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)


class GridCell(TelemetryModel):
    column: int = Field(ge=0)
    row: int = Field(ge=0)
    hit_count: int = Field(default=1, ge=1)
    height_hint_m: float = Field(default=0.8, ge=0.0)


class OccupancyState(TelemetryModel):
    resolution_m: float = Field(default=0.25, gt=0.0)
    origin: Point2D = Field(default_factory=lambda: Point2D(x_m=0.0, y_m=0.0))
    width: int = Field(default=80, ge=1)
    height: int = Field(default=128, ge=1)
    occupied_cells: list[GridCell] = Field(default_factory=list)
    updated_at_ms: int = Field(default_factory=now_ms, ge=0)


class VehiclePose(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    vehicle_id: str = "DUMPER_01"
    x_m: float = 0.0
    y_m: float = 0.0
    heading_deg: float = Field(default=0.0, ge=0.0, lt=360.0)
    speed_mps: float = Field(default=0.0, ge=0.0)
    position_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    mode: DataMode = DataMode.SIMULATED


class RangeReading(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    sensor_id: str
    angle_deg: float = 0.0
    range_m: float = Field(ge=0.0)
    quality: float = Field(default=1.0, ge=0.0, le=1.0)
    max_range_m: float = Field(default=4.0, gt=0.0)
    is_valid: bool = True
    mode: DataMode = DataMode.SIMULATED


class MotionState(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    left_hall_ticks: int = Field(default=0, ge=0)
    right_hall_ticks: int = Field(default=0, ge=0)
    left_distance_m: float = Field(default=0.0, ge=0.0)
    right_distance_m: float = Field(default=0.0, ge=0.0)
    imu_heading_deg: float = Field(default=0.0, ge=0.0, lt=360.0)
    imu_yaw_rate_dps: float = 0.0
    aruco_visible: bool = True
    localization_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    provider_confidence: dict[str, float] = Field(default_factory=dict)
    mode: DataMode = DataMode.SIMULATED


class VisibilityMetrics(TelemetryModel):
    contrast: float = Field(default=0.0, ge=0.0, le=1.0)
    edge_density: float = Field(default=0.0, ge=0.0, le=1.0)
    brightness: float = Field(default=0.0, ge=0.0, le=1.0)
    entropy: float = Field(default=0.0, ge=0.0, le=1.0)
    haze_proxy: float = Field(default=1.0, ge=0.0, le=1.0)


class CameraState(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    raw_frame_id: str | None = None
    enhanced_frame_id: str | None = None
    raw_available: bool = False
    enhancement_available: bool = False
    metrics: VisibilityMetrics = Field(default_factory=VisibilityMetrics)
    visibility_score: float | None = Field(default=None, ge=0.0, le=1.0)
    visibility_state: VisibilityState | None = None
    stream_status: Literal[
        "disabled", "connecting", "live", "stale", "error", "simulated"
    ] = "disabled"
    stream_detail: str | None = None
    width_px: int | None = Field(default=None, gt=0)
    height_px: int | None = Field(default=None, gt=0)
    measured_fps: float = Field(default=0.0, ge=0.0)
    enhancement_status: Literal[
        "disabled", "loading", "live", "stale", "error"
    ] = "disabled"
    enhancement_detail: str | None = None
    enhancement_model: str | None = None
    enhancement_device: str | None = None
    enhancement_precision: str | None = None
    enhancement_latency_ms: float | None = Field(default=None, ge=0.0)
    enhancement_fps: float = Field(default=0.0, ge=0.0)
    enhancement_peak_vram_mb: float = Field(default=0.0, ge=0.0)
    ir_available: bool = False
    ir_frame_id: str | None = None
    ir_status: Literal[
        "disabled", "loading", "live", "stale", "error"
    ] = "disabled"
    ir_detail: str | None = None
    ir_model: str | None = None
    ir_device: str | None = None
    ir_precision: str | None = None
    ir_latency_ms: float | None = Field(default=None, ge=0.0)
    ir_fps: float = Field(default=0.0, ge=0.0)
    ir_peak_vram_mb: float = Field(default=0.0, ge=0.0)
    mode: DataMode = DataMode.SIMULATED


class RadarObject(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    detection_id: str
    range_m: float = Field(ge=0.0)
    bearing_deg: float
    relative_velocity_mps: float = 0.0
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    mode: DataMode = DataMode.SIMULATED


class EnvironmentState(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    temperature_c: float = 26.0
    pressure_hpa: float = Field(default=1008.0, gt=0.0)
    relative_altitude_m: float = 0.0
    visibility_score: float = Field(default=1.0, ge=0.0, le=1.0)
    visibility_state: VisibilityState = VisibilityState.GOOD
    mode: DataMode = DataMode.SIMULATED


class LiveObject(TelemetryModel):
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    object_id: str
    x_m: float
    y_m: float
    object_type: LiveObjectType = LiveObjectType.UNKNOWN_OBSTACLE
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source: ObjectSource = ObjectSource.TOF
    mode: DataMode = DataMode.SIMULATED


class EmergencyState(TelemetryModel):
    state: EmergencyLevel = EmergencyLevel.SAFE
    reason: str | None = None
    nearest_obstacle_m: float | None = Field(default=None, ge=0.0)
    critical_distance_m: float | None = Field(default=None, ge=0.0)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    motor_cut: bool = False
    latched_at_ms: int | None = Field(default=None, ge=0)


class SensorHealth(TelemetryModel):
    sensor_id: str
    status: SensorStatus = SensorStatus.HEALTHY
    last_update_ms: int = Field(default_factory=now_ms, ge=0)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    detail: str | None = None


class AlertEvent(TelemetryModel):
    event_id: str
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    severity: Literal["INFO", "WARNING", "CRITICAL"]
    title: str
    detail: str
    vehicle_id: str = "DUMPER_01"


class RecordingState(TelemetryModel):
    recording: bool = False
    recording_filename: str | None = None
    replaying: bool = False
    replay_filename: str | None = None


class SimulationState(TelemetryModel):
    running: bool = True
    scenario: SimulationScenario = SimulationScenario.NORMAL
    speed_scale: float = Field(default=1.0, ge=0.0, le=3.0)
    obstacle_enabled: bool = False
    visibility_score: float = Field(default=0.88, ge=0.0, le=1.0)
    front_scanner_angle_deg: float = 0.0
    rear_scanner_angle_deg: float = 0.0


class SimulationControlRequest(TelemetryModel):
    scenario: SimulationScenario | None = None
    running: bool | None = None
    speed_scale: float | None = Field(default=None, ge=0.0, le=3.0)
    obstacle_enabled: bool | None = None
    visibility_score: float | None = Field(default=None, ge=0.0, le=1.0)
    reset: bool = False


class WorldState(TelemetryModel):
    schema_version: Literal["1.0"] = "1.0"
    generated_at_ms: int = Field(default_factory=now_ms, ge=0)
    sequence: int = Field(default=0, ge=0)
    mode: DataMode = DataMode.SIMULATED
    primary_vehicle_id: str = "DUMPER_01"
    vehicles: list[VehiclePose] = Field(default_factory=lambda: [VehiclePose()])
    reference_map: ReferenceMap | None = None
    ranges: list[RangeReading] = Field(default_factory=list)
    motion: MotionState = Field(default_factory=MotionState)
    camera: CameraState = Field(default_factory=CameraState)
    environment: EnvironmentState = Field(default_factory=EnvironmentState)
    live_objects: list[LiveObject] = Field(default_factory=list)
    radar_objects: list[RadarObject] = Field(default_factory=list)
    emergency: EmergencyState = Field(default_factory=EmergencyState)
    sensor_health: list[SensorHealth] = Field(default_factory=list)
    safe_corridor: SafeCorridor = Field(default_factory=SafeCorridor)
    spatial_points: list[SpatialPoint] = Field(default_factory=list)
    occupancy: OccupancyState = Field(default_factory=OccupancyState)
    alerts: list[AlertEvent] = Field(default_factory=list)
    recording: RecordingState = Field(default_factory=RecordingState)
    simulation: SimulationState = Field(default_factory=SimulationState)
    v2x: V2XState = Field(default_factory=V2XState)
    operations: MineOperationsState = Field(default_factory=MineOperationsState)

    def primary_vehicle(self) -> VehiclePose:
        for vehicle in self.vehicles:
            if vehicle.vehicle_id == self.primary_vehicle_id:
                return vehicle
        raise ValueError(f"Primary vehicle is missing: {self.primary_vehicle_id}")


class SystemStatus(TelemetryModel):
    service: Literal["fogsen-backend"] = "fogsen-backend"
    status: Literal["ok", "degraded"] = "ok"
    version: str = "0.1.0"
    mode: DataMode = DataMode.SIMULATED
    websocket_path: str = "/ws/telemetry"
    telemetry_hz: float = 10.0
    world_sequence: int = 0
    recording: bool = False
    replaying: bool = False
    runtime_detail: str | None = None
    serial_port: str | None = None
    telemetry_transport: Literal["SERIAL", "WIFI", "BOTH", "SIMULATED"] = "SIMULATED"
    telemetry_endpoint: str | None = None
    active_telemetry_sources: list[str] = Field(default_factory=list)
    telemetry_source_errors: dict[str, str] = Field(default_factory=dict)
    last_telemetry_ms: int | None = Field(default=None, ge=0)
