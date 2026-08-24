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
  motor_cut: boolean;
}

export interface SensorHealth {
  sensor_id: string;
  status: SensorStatus;
  last_update_ms: number;
  confidence: number;
  detail: string | null;
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
}
