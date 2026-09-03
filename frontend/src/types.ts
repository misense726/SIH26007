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
export type SimulationScenario =
  | "NORMAL"
  | "FOG"
  | "OBSTACLE"
  | "EMERGENCY"
  | "SCENARIO_1_DENSE_FOG"
  | "SCENARIO_2_VEHICLE_AHEAD"
  | "SCENARIO_3_OPPOSING_VEHICLE"
  | "SCENARIO_4_STATIC_OBSTACLE"
  | "SCENARIO_5_ROAD_CLOSURE_REROUTE"
  | "SCENARIO_6_PAYLOAD_ROUTING"
  | "SCENARIO_7_FLEET_MONITORING"
  | "SCENARIO_8_HAULAGE_ANALYTICS";

export type NodeType = "BENCH" | "DUMP" | "JUNCTION" | "WAYPOINT";
export type RoadStatus = "OPEN" | "RESTRICTED" | "CLOSED";

export interface MineNode {
  node_id: string;
  name: string;
  x_m: number;
  y_m: number;
  elevation_m: number;
  node_type: NodeType;
  description?: string;
}

export interface MineEdge {
  edge_id: string;
  from_node: string;
  to_node: string;
  distance_m: number;
  gradient_pct: number;
  max_weight_tonnes: number;
  road_status: RoadStatus;
  speed_limit_kmh: number;
  risk_penalty: number;
  lanes: number;
  is_bidirectional: boolean;
  surface?: string;
  segment_name?: string;
}

export interface MineNetwork {
  network_id: string;
  name: string;
  mine_site: string;
  nodes: Record<string, MineNode>;
  edges: Record<string, MineEdge>;
}

export type HaulCycleState =
  | "IDLE"
  | "TRAVELLING_TO_PICKUP"
  | "WAITING_FOR_LOADING"
  | "LOADED"
  | "TRAVELLING_TO_DUMP"
  | "WAITING_FOR_DUMP"
  | "DUMPING"
  | "RETURNING_EMPTY"
  | "PAUSED"
  | "EMERGENCY";

export interface FleetVehicleSummary {
  vehicle_id: string;
  callsign: string;
  is_primary: boolean;
  is_simulated: boolean;
  cycle_state: HaulCycleState;
  payload_tonnes: number;
  tare_weight_tonnes: number;
  total_weight_tonnes: number;
  x_m: number;
  y_m: number;
  elevation_m: number;
  heading_deg: number;
  speed_mps: number;
  speed_kmh: number;
  emergency_state: string;
  current_edge_id?: string | null;
  assigned_pickup: string;
  assigned_dump: string;
  total_trips_completed: number;
  total_tonnes_moved: number;
  current_destination: string;
  distance_to_destination_m: number;
  next_instruction: string;
}

export interface GuidanceResponse {
  vehicle_id: string;
  callsign: string;
  current_destination: string;
  distance_remaining_m: number;
  next_instruction: string;
  speed_kmh: number;
  target_vehicle_id: string;
  target_callsign: string;
  hazard_distance_m: number;
  hazard_direction: string;
  closing_velocity_mps: number;
  threat_level: "SAFE" | "CAUTION" | "WARNING" | "CRITICAL" | string;
  advisory_text: string;
  visibility_score: number;
  visibility_state: string;
  estimated_sight_distance_m: number;
}

export interface TripRecord {
  trip_id: string;
  vehicle_id: string;
  callsign: string;
  pickup_node: string;
  dump_node: string;
  payload_tonnes: number;
  start_time_ms: number;
  end_time_ms: number;
  cycle_duration_s: number;
  loading_wait_s: number;
  loaded_travel_s: number;
  dumping_wait_s: number;
  empty_return_s: number;
  idle_s: number;
  distance_km: number;
  avg_speed_kmh: number;
  route_deviations_count: number;
  route_compliance_pct: number;
  fuel_litres_est: number;
}

export interface CycleTimeBreakdown {
  loading_wait_minutes: number;
  loaded_travel_minutes: number;
  dumping_wait_minutes: number;
  empty_return_minutes: number;
  idle_minutes: number;
  total_cycle_minutes: number;
  loading_pct: number;
  loaded_travel_pct: number;
  dumping_pct: number;
  empty_return_pct: number;
  idle_pct: number;
}

export interface HaulageMetrics {
  total_completed_cycles: number;
  total_ore_moved_tonnes: number;
  avg_cycle_time_minutes: number;
  fleet_utilization_pct: number;
  total_distance_km: number;
  route_compliance_pct: number;
  active_fleet_count: number;
  cycle_time_breakdown: CycleTimeBreakdown;
  ore_moved_by_vehicle: Record<string, number>;
  cycles_by_vehicle: Record<string, number>;
  hourly_production_rate_tph: number;
  recent_delay_events: string[];
}

export interface TripHistoryResponse {
  trips: TripRecord[];
  total_trips: number;
  total_tonnes: number;
}

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
  coordinate_frame_id?: string;
  source: string;
  source_detail?: string | null;
  geographic_anchor?: Record<string, number> | null;
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
  operations?: MineOperationsState;
}

export interface VehicleOperationalMetadata {
  vehicle_id: string;
  callsign: string;
  is_primary: boolean;
  is_simulated: boolean;
  cycle_state: HaulCycleState;
  payload_tonnes: number;
  tare_weight_tonnes: number;
  total_weight_tonnes: number;
  elevation_m: number;
  assigned_pickup: string;
  assigned_dump: string;
  current_destination: string;
  distance_to_destination_m: number;
  next_instruction: string;
  current_edge_id: string | null;
  emergency_state: string;
  total_trips_completed: number;
  total_tonnes_moved: number;
  target_payload_tonnes: number;
  color: string;
}

export interface TacticalGuidance {
  vehicle_id: string;
  callsign: string;
  current_destination: string;
  distance_remaining_m: number;
  next_instruction: string;
  speed_kmh: number;
  target_vehicle_id: string;
  target_callsign: string;
  hazard_distance_m: number;
  hazard_direction: string;
  closing_velocity_mps: number;
  threat_level: string;
  advisory_text: string;
  visibility_score: number;
  visibility_state: string;
  estimated_sight_distance_m: number;
}

export interface HaulageMetricsSummary {
  total_completed_cycles: number;
  total_ore_moved_tonnes: number;
  avg_cycle_time_minutes: number;
  fleet_utilization_pct: number;
  total_distance_km: number;
  route_compliance_pct: number | null;
  active_fleet_count: number;
  hourly_production_rate_tph: number;
  recent_delay_events: string[];
}

export interface MineOperationsState {
  network: MineNetwork | null;
  fleet: Record<string, VehicleOperationalMetadata>;
  routes: Record<string, NavigationRoute>;
  guidance: Record<string, TacticalGuidance>;
  reroute_advisories: RerouteAdvisory[];
  analytics_summary: HaulageMetricsSummary;
  provenance: string;
  network_version: number;
}
