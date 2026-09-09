export type DataMode = "LIVE" | "SIMULATED" | "REPLAY";
export type VisibilityState = "GOOD" | "MODERATE" | "LOW" | "VERY_LOW";
export type EmergencyLevel = "SAFE" | "WARNING" | "CRITICAL" | "EMERGENCY_STOP";
export type SensorStatus = "HEALTHY" | "DEGRADED" | "STALE" | "OFFLINE";
export type MapFeatureType =
  | "TERRAIN"
  | "ROAD"
  | "CENTERLINE"
  | "BERM"
  | "HAZARD_ZONE"
  | "ROUTE"
  | "INTERSECTION"
  | "STATIC_OBSTACLE"
  | "SPEED_ZONE"
  | "START"
  | "DESTINATION";
export type GeometryType = "POINT" | "POLYLINE" | "POLYGON";
export type CorridorState = "GREEN" | "YELLOW" | "RED" | "GREY";
export type SimulationScenario = "HAUL" | "NORMAL" | "FOG" | "OBSTACLE" | "EMERGENCY";

export interface Point2D {
  x_m: number;
  y_m: number;
}

export interface MapFeature {
  feature_id: string;
  feature_type: MapFeatureType;
  geometry_type: GeometryType;
  points: Point2D[];
  label: string;
  properties: Record<string, string | number | boolean>;
}

export interface ReferenceMap {
  map_id: string;
  name: string;
  version: number;
  created_at_ms: number;
  coordinate_frame: "LOCAL_CARTESIAN_METRES";
  source: "MANUAL" | "SURVEYED" | "IMPORTED";
  features: MapFeature[];
}

export interface VehiclePose {
  timestamp_ms: number;
  vehicle_id: string;
  x_m: number;
  y_m: number;
  heading_deg: number;
  speed_mps: number;
  position_confidence: number;
  mode: DataMode;
}

export interface RangeReading {
  timestamp_ms: number;
  sensor_id: string;
  angle_deg: number;
  range_m: number;
  quality: number;
  max_range_m: number;
  is_valid: boolean;
  mode: DataMode;
}

export interface SpatialPoint {
  x_m: number;
  y_m: number;
  height_hint_m: number;
  source_sensor_id: string;
  quality: number;
  timestamp_ms: number;
}

export interface MotionState {
  timestamp_ms: number;
  left_hall_ticks: number;
  right_hall_ticks: number;
  left_distance_m: number;
  right_distance_m: number;
  imu_heading_deg: number;
  imu_yaw_rate_dps: number;
  aruco_visible: boolean;
  localization_confidence: number;
  provider_confidence: Record<string, number>;
  mode: DataMode;
}

export interface VisibilityMetrics {
  contrast: number;
  edge_density: number;
  brightness: number;
  entropy: number;
  haze_proxy: number;
}

export interface CameraState {
  timestamp_ms: number;
  raw_frame_id: string | null;
  enhanced_frame_id: string | null;
  raw_available: boolean;
  enhancement_available: boolean;
  metrics: VisibilityMetrics;
  visibility_score: number | null;
  visibility_state: VisibilityState | null;
  stream_status: "disabled" | "connecting" | "live" | "stale" | "error" | "simulated";
  stream_detail: string | null;
  width_px: number | null;
  height_px: number | null;
  measured_fps: number;
  enhancement_status: "disabled" | "loading" | "live" | "stale" | "error";
  enhancement_detail: string | null;
  enhancement_model: string | null;
  enhancement_device: string | null;
  enhancement_precision: string | null;
  enhancement_latency_ms: number | null;
  enhancement_fps: number;
  enhancement_peak_vram_mb: number;
  ir_available: boolean;
  ir_frame_id: string | null;
  ir_status: "disabled" | "loading" | "live" | "stale" | "error";
  ir_detail: string | null;
  ir_model: string | null;
  ir_device: string | null;
  ir_precision: string | null;
  ir_latency_ms: number | null;
  ir_fps: number;
  ir_peak_vram_mb: number;
  mode: DataMode;
}

export interface EnvironmentState {
  timestamp_ms: number;
  temperature_c: number;
  pressure_hpa: number;
  relative_altitude_m: number;
  visibility_score: number;
  visibility_state: VisibilityState;
  mode: DataMode;
}

export interface EmergencyState {
  state: EmergencyLevel;
  reason: string | null;
  nearest_obstacle_m: number | null;
  critical_distance_m: number | null;
  confidence: number;
  motor_cut: boolean;
  latched_at_ms: number | null;
}

export interface SensorHealth {
  sensor_id: string;
  status: SensorStatus;
  last_update_ms: number;
  confidence: number;
  detail: string | null;
}

export interface RadarObject {
  timestamp_ms: number;
  detection_id: string;
  range_m: number;
  bearing_deg: number;
  relative_velocity_mps: number;
  confidence: number;
  mode: DataMode;
}

export interface AlertEvent {
  event_id: string;
  timestamp_ms: number;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  detail: string;
  vehicle_id: string;
}

export interface RecordingState {
  recording: boolean;
  recording_filename: string | null;
  replaying: boolean;
  replay_filename: string | null;
}

export interface SimulationState {
  running: boolean;
  scenario: SimulationScenario;
  speed_scale: number;
  obstacle_enabled: boolean;
  visibility_score: number;
  front_scanner_angle_deg: number;
  rear_scanner_angle_deg: number;
}

export interface SimulationControlRequest {
  scenario?: SimulationScenario;
  running?: boolean;
  speed_scale?: number;
  obstacle_enabled?: boolean;
  visibility_score?: number;
  reset?: boolean;
}

export type V2XMessageType =
  | "V2V_BSM"
  | "V2V_PROXIMITY_ALERT"
  | "V2I_ADVISORY"
  | "V2I_INTERSECTION_PRIORITY"
  | "V2I_EMERGENCY_BROADCAST";

export type V2IAdvisoryType =
  | "FOG_WARNING"
  | "SPEED_RESTRICTION"
  | "HAZARD_ZONE"
  | "PASSAGE_PRIORITY"
  | "DISPATCH"
  | "ROAD_MAINTENANCE";

export interface V2VBasicSafetyMessage {
  message_id: string;
  timestamp_ms: number;
  vehicle_id: string;
  x_m: number;
  y_m: number;
  heading_deg: number;
  speed_mps: number;
  emergency_state: EmergencyLevel | string;
  corridor_state: CorridorState | string;
  nearest_obstacle_m: number | null;
  brake_applied: boolean;
}

export interface V2IAdvisoryMessage {
  message_id: string;
  timestamp_ms: number;
  rsu_id: string;
  rsu_name: string;
  advisory_type: V2IAdvisoryType;
  title: string;
  detail: string;
  speed_limit_kmh: number | null;
  expires_at_ms: number | null;
  zone_x_m: number | null;
  zone_y_m: number | null;
  zone_radius_m: number | null;
}

export interface V2XMessage {
  message_id: string;
  timestamp_ms: number;
  msg_type: V2XMessageType;
  source_id: string;
  target_id: string;
  summary: string;
  bsm_payload?: V2VBasicSafetyMessage | null;
  advisory_payload?: V2IAdvisoryMessage | null;
}

export interface V2XPeerNode {
  vehicle_id: string;
  last_seen_ms: number;
  x_m: number;
  y_m: number;
  distance_m: number;
  bearing_deg?: number;
  speed_mps: number;
  heading_deg: number;
  emergency_state: EmergencyLevel | string;
  rssi_dbm: number;
  link_status: "EXCELLENT" | "GOOD" | "DEGRADED" | "LOST";
}

export interface V2XInfrastructureNode {
  rsu_id: string;
  name: string;
  x_m: number;
  y_m: number;
  status: "ACTIVE" | "STANDBY" | "OFFLINE";
  coverage_radius_m: number;
  active_advisories_count: number;
}

export interface V2XState {
  timestamp_ms: number;
  enabled: boolean;
  node_id: string;
  protocol_version: string;
  tx_packet_count: number;
  rx_packet_count: number;
  channel_frequency_mhz: number;
  active_peers: V2XPeerNode[];
  infrastructure_nodes: V2XInfrastructureNode[];
  active_advisories: V2IAdvisoryMessage[];
  recent_messages: V2XMessage[];
}

export interface HaulRouteState {
  cycle?: number;
  traffic_slowing?: boolean;
  lead_waiting?: boolean;
  obstacle_detected?: boolean;
  obstacle_distance_m?: number | null;
  planned_path?: Point2D[];
  origin: string;
  destination: string;
  phase: "HAULING" | "OBSTACLE" | "WAITING" | "ARRIVED";
  distance_m: number;
  total_distance_m: number;
  remaining_m: number;
  elapsed_s: number;
  obstacle: Point2D | null;
  obstacle_radius_m: number;
  next_instruction: string;
}

export interface WorldState {
  vehicle_telemetry?: Array<{
    vehicle_id: "DUMPER_01" | "DUMPER_02";
    received_at_ms: number;
    online: boolean;
    gps: {
      fix: boolean;
      lat: number | null;
      lon: number | null;
      alt_m: number | null;
      speed_mps: number | null;
      sats: number;
      hdop: number | null;
      age: number | null;
      bytes: number;
    };
    load: {
      ready: boolean;
      tared: boolean;
      taring: boolean;
      calibrated: boolean;
      zero_offset: number;
      raw: number | null;
      net_raw: number | null;
      kg: number | null;
    } | null;
  }>;
  schema_version: "1.0";
  generated_at_ms: number;
  sequence: number;
  mode: DataMode;
  primary_vehicle_id: string;
  vehicles: VehiclePose[];
  reference_map: ReferenceMap | null;
  ranges: RangeReading[];
  motion: MotionState;
  camera: CameraState;
  environment: EnvironmentState;
  live_objects: Array<{
    timestamp_ms: number;
    object_id: string;
    x_m: number;
    y_m: number;
    object_type: string;
    confidence: number;
    source: string;
    mode: DataMode;
  }>;
  radar_objects: RadarObject[];
  emergency: EmergencyState;
  sensor_health: SensorHealth[];
  safe_corridor: {
    state: CorridorState;
    polygon: Point2D[];
    exclusions: MapFeature[];
    confidence: number;
    reason: string;
  };
  spatial_points: SpatialPoint[];
  occupancy: {
    resolution_m: number;
    origin: Point2D;
    width: number;
    height: number;
    occupied_cells: Array<{
      column: number;
      row: number;
      hit_count: number;
      height_hint_m: number;
    }>;
    updated_at_ms: number;
  };
  alerts: AlertEvent[];
  recording: RecordingState;
  simulation: SimulationState;
  v2x?: V2XState;
  haul_route?: HaulRouteState | null;
}
