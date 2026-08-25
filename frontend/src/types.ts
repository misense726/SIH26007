export type DataMode = "LIVE" | "SIMULATED" | "REPLAY";
export type VisibilityState = "GOOD" | "MODERATE" | "LOW" | "VERY_LOW";
export type EmergencyLevel = "SAFE" | "WARNING" | "CRITICAL" | "EMERGENCY_STOP";
export type SensorStatus = "HEALTHY" | "DEGRADED" | "STALE" | "OFFLINE";
export type MapFeatureType =
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
export type SimulationScenario = "NORMAL" | "FOG" | "OBSTACLE" | "EMERGENCY";

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

export interface WorldState {
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
  spatial_points: Array<{
    x_m: number;
    y_m: number;
    height_hint_m: number;
    source_sensor_id: string;
    quality: number;
    timestamp_ms: number;
  }>;
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
}
