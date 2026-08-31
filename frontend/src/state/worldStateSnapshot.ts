import type { DataMode, WorldState } from "../types";

type UnknownRecord = Record<string, unknown>;

const DATA_MODES = new Set<DataMode>(["LIVE", "SIMULATED", "REPLAY"]);
const CORRIDOR_STATES = new Set(["GREEN", "YELLOW", "RED", "GREY"]);
const EMERGENCY_STATES = new Set(["SAFE", "WARNING", "CRITICAL", "EMERGENCY_STOP"]);
const SENSOR_STATES = new Set(["HEALTHY", "DEGRADED", "STALE", "OFFLINE"]);
const VISIBILITY_STATES = new Set(["GOOD", "MODERATE", "LOW", "VERY_LOW"]);
const MAP_FEATURE_TYPES = new Set([
  "ROAD",
  "CENTERLINE",
  "BERM",
  "HAZARD_ZONE",
  "ROUTE",
  "INTERSECTION",
  "STATIC_OBSTACLE",
  "SPEED_ZONE",
  "START",
  "DESTINATION",
]);
const GEOMETRY_TYPES = new Set(["POINT", "POLYLINE", "POLYGON"]);
const SIMULATION_SCENARIOS = new Set(["NORMAL", "FOG", "OBSTACLE", "EMERGENCY"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function hasFiniteNumbers(record: UnknownRecord, keys: string[]): boolean {
  return keys.every((key) => isFiniteNumber(record[key]));
}

function hasStrings(record: UnknownRecord, keys: string[]): boolean {
  return keys.every((key) => typeof record[key] === "string");
}

function hasNullableFiniteNumbers(record: UnknownRecord, keys: string[]): boolean {
  return keys.every((key) => isNullableFiniteNumber(record[key]));
}

function hasNullableStrings(record: UnknownRecord, keys: string[]): boolean {
  return keys.every((key) => isNullableString(record[key]));
}

function isPoint2D(value: unknown): boolean {
  return isRecord(value) && hasFiniteNumbers(value, ["x_m", "y_m"]);
}

function isPrimitiveProperties(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    )
  );
}

function isMapFeature(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["feature_id", "feature_type", "geometry_type", "label"]) &&
    MAP_FEATURE_TYPES.has(value.feature_type as string) &&
    GEOMETRY_TYPES.has(value.geometry_type as string) &&
    Array.isArray(value.points) &&
    value.points.length > 0 &&
    value.points.every(isPoint2D) &&
    isPrimitiveProperties(value.properties)
  );
}

function hasMode(value: unknown): value is DataMode {
  return typeof value === "string" && DATA_MODES.has(value as DataMode);
}

function isVehicle(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["vehicle_id"]) &&
    hasFiniteNumbers(value, [
      "timestamp_ms",
      "x_m",
      "y_m",
      "heading_deg",
      "speed_mps",
      "position_confidence",
    ]) &&
    hasMode(value.mode)
  );
}

function isRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["sensor_id"]) &&
    hasFiniteNumbers(value, [
      "timestamp_ms",
      "angle_deg",
      "range_m",
      "quality",
      "max_range_m",
    ]) &&
    typeof value.is_valid === "boolean" &&
    hasMode(value.mode)
  );
}

function isSensorHealth(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["sensor_id"]) &&
    typeof value.status === "string" &&
    SENSOR_STATES.has(value.status) &&
    hasFiniteNumbers(value, ["last_update_ms", "confidence"]) &&
    isNullableString(value.detail)
  );
}

function hasCameraShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.metrics) &&
    hasFiniteNumbers(value.metrics, [
      "contrast",
      "edge_density",
      "brightness",
      "entropy",
      "haze_proxy",
    ]) &&
    hasMode(value.mode) &&
    typeof value.raw_available === "boolean" &&
    typeof value.enhancement_available === "boolean" &&
    typeof value.ir_available === "boolean" &&
    hasStrings(value, ["stream_status", "enhancement_status", "ir_status"]) &&
    hasNullableStrings(value, [
      "raw_frame_id",
      "enhanced_frame_id",
      "stream_detail",
      "enhancement_detail",
      "enhancement_model",
      "enhancement_device",
      "enhancement_precision",
      "ir_frame_id",
      "ir_detail",
      "ir_model",
      "ir_device",
      "ir_precision",
    ]) &&
    hasNullableFiniteNumbers(value, [
      "visibility_score",
      "width_px",
      "height_px",
      "enhancement_latency_ms",
      "ir_latency_ms",
    ]) &&
    (value.visibility_state === null ||
      (typeof value.visibility_state === "string" &&
        VISIBILITY_STATES.has(value.visibility_state))) &&
    hasFiniteNumbers(value, [
      "timestamp_ms",
      "measured_fps",
      "enhancement_fps",
      "enhancement_peak_vram_mb",
      "ir_fps",
      "ir_peak_vram_mb",
    ])
  );
}

function hasMotionShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.provider_confidence) &&
    Object.values(value.provider_confidence).every(isFiniteNumber) &&
    hasMode(value.mode) &&
    typeof value.aruco_visible === "boolean" &&
    hasFiniteNumbers(value, [
      "timestamp_ms",
      "left_hall_ticks",
      "right_hall_ticks",
      "left_distance_m",
      "right_distance_m",
      "imu_heading_deg",
      "imu_yaw_rate_dps",
      "localization_confidence",
    ])
  );
}

function hasEnvironmentShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasMode(value.mode) &&
    typeof value.visibility_state === "string" &&
    VISIBILITY_STATES.has(value.visibility_state) &&
    hasFiniteNumbers(value, [
      "timestamp_ms",
      "temperature_c",
      "pressure_hpa",
      "relative_altitude_m",
      "visibility_score",
    ])
  );
}

function hasEmergencyShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    EMERGENCY_STATES.has(value.state) &&
    typeof value.motor_cut === "boolean" &&
    isNullableString(value.reason) &&
    hasNullableFiniteNumbers(value, [
      "nearest_obstacle_m",
      "critical_distance_m",
      "latched_at_ms",
    ]) &&
    hasFiniteNumbers(value, ["confidence"])
  );
}

function hasCorridorShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    CORRIDOR_STATES.has(value.state) &&
    Array.isArray(value.polygon) &&
    value.polygon.every(isPoint2D) &&
    Array.isArray(value.exclusions) &&
    value.exclusions.every(isMapFeature) &&
    isFiniteNumber(value.confidence) &&
    typeof value.reason === "string"
  );
}

function hasOccupancyShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPoint2D(value.origin) &&
    Array.isArray(value.occupied_cells) &&
    value.occupied_cells.every(
      (cell) =>
        isRecord(cell) &&
        hasFiniteNumbers(cell, ["column", "row", "hit_count", "height_hint_m"]),
    ) &&
    hasFiniteNumbers(value, ["resolution_m", "width", "height", "updated_at_ms"])
  );
}

function hasSimulationShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.running === "boolean" &&
    typeof value.scenario === "string" &&
    SIMULATION_SCENARIOS.has(value.scenario) &&
    typeof value.obstacle_enabled === "boolean" &&
    hasFiniteNumbers(value, [
      "speed_scale",
      "visibility_score",
      "front_scanner_angle_deg",
      "rear_scanner_angle_deg",
    ])
  );
}

function hasRecordingShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.recording === "boolean" &&
    typeof value.replaying === "boolean" &&
    hasNullableStrings(value, ["recording_filename", "replay_filename"])
  );
}

function hasReferenceMapShape(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      hasStrings(value, ["map_id", "name", "coordinate_frame", "source"]) &&
      hasFiniteNumbers(value, ["version", "created_at_ms"]) &&
      Array.isArray(value.features) &&
      value.features.every(isMapFeature))
  );
}

function isLiveObject(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["object_id", "object_type", "source"]) &&
    hasFiniteNumbers(value, ["timestamp_ms", "x_m", "y_m", "confidence"]) &&
    hasMode(value.mode)
  );
}

function isRadarObject(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["detection_id"]) &&
    hasFiniteNumbers(value, [
      "timestamp_ms",
      "range_m",
      "bearing_deg",
      "relative_velocity_mps",
      "confidence",
    ]) &&
    hasMode(value.mode)
  );
}

function isSpatialPoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["source_sensor_id"]) &&
    hasFiniteNumbers(value, [
      "x_m",
      "y_m",
      "height_hint_m",
      "quality",
      "timestamp_ms",
    ])
  );
}

function isAlert(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["event_id", "severity", "title", "detail", "vehicle_id"]) &&
    isFiniteNumber(value.timestamp_ms)
  );
}

function isV2xPeer(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["vehicle_id", "emergency_state", "link_status"]) &&
    hasFiniteNumbers(value, [
      "last_seen_ms",
      "x_m",
      "y_m",
      "distance_m",
      "speed_mps",
      "heading_deg",
      "rssi_dbm",
    ]) &&
    (value.bearing_deg === undefined || isFiniteNumber(value.bearing_deg))
  );
}

function isV2xInfrastructureNode(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["rsu_id", "name", "status"]) &&
    hasFiniteNumbers(value, [
      "x_m",
      "y_m",
      "coverage_radius_m",
      "active_advisories_count",
    ])
  );
}

function isV2xAdvisory(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, [
      "message_id",
      "rsu_id",
      "rsu_name",
      "advisory_type",
      "title",
      "detail",
    ]) &&
    isFiniteNumber(value.timestamp_ms) &&
    hasNullableFiniteNumbers(value, [
      "speed_limit_kmh",
      "expires_at_ms",
      "zone_x_m",
      "zone_y_m",
      "zone_radius_m",
    ])
  );
}

function isOptionalPayload(value: unknown): boolean {
  return value === undefined || value === null || isRecord(value);
}

function isV2xMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["message_id", "msg_type", "source_id", "target_id", "summary"]) &&
    isFiniteNumber(value.timestamp_ms) &&
    isOptionalPayload(value.bsm_payload) &&
    isOptionalPayload(value.advisory_payload)
  );
}

function hasV2xShape(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.enabled === "boolean" &&
      hasStrings(value, ["node_id", "protocol_version"]) &&
      hasFiniteNumbers(value, [
        "timestamp_ms",
        "tx_packet_count",
        "rx_packet_count",
        "channel_frequency_mhz",
      ]) &&
      Array.isArray(value.active_peers) &&
      value.active_peers.every(isV2xPeer) &&
      Array.isArray(value.infrastructure_nodes) &&
      value.infrastructure_nodes.every(isV2xInfrastructureNode) &&
      Array.isArray(value.active_advisories) &&
      value.active_advisories.every(isV2xAdvisory) &&
      Array.isArray(value.recent_messages) &&
      value.recent_messages.every(isV2xMessage))
  );
}

export function isWorldStateSnapshot(value: unknown): value is WorldState {
  if (!isRecord(value)) return false;

  return (
    value.schema_version === "1.0" &&
    hasMode(value.mode) &&
    hasStrings(value, ["primary_vehicle_id"]) &&
    hasFiniteNumbers(value, ["generated_at_ms", "sequence"]) &&
    Array.isArray(value.vehicles) &&
    value.vehicles.every(isVehicle) &&
    hasReferenceMapShape(value.reference_map) &&
    Array.isArray(value.ranges) &&
    value.ranges.every(isRange) &&
    hasMotionShape(value.motion) &&
    hasCameraShape(value.camera) &&
    hasEnvironmentShape(value.environment) &&
    Array.isArray(value.live_objects) &&
    value.live_objects.every(isLiveObject) &&
    Array.isArray(value.radar_objects) &&
    value.radar_objects.every(isRadarObject) &&
    hasEmergencyShape(value.emergency) &&
    Array.isArray(value.sensor_health) &&
    value.sensor_health.every(isSensorHealth) &&
    hasCorridorShape(value.safe_corridor) &&
    Array.isArray(value.spatial_points) &&
    value.spatial_points.every(isSpatialPoint) &&
    hasOccupancyShape(value.occupancy) &&
    Array.isArray(value.alerts) &&
    value.alerts.every(isAlert) &&
    hasRecordingShape(value.recording) &&
    hasSimulationShape(value.simulation) &&
    hasV2xShape(value.v2x)
  );
}
