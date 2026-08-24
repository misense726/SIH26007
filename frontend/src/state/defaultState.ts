import type { WorldState } from "../types";

export const defaultWorldState: WorldState = {
  schema_version: "1.0",
  generated_at_ms: 0,
  sequence: 0,
  mode: "SIMULATED",
  primary_vehicle_id: "DUMPER_01",
  vehicles: [
    {
      timestamp_ms: 0,
      vehicle_id: "DUMPER_01",
      x_m: 0,
      y_m: 0,
      heading_deg: 0,
      speed_mps: 0,
      position_confidence: 0,
      mode: "SIMULATED",
    },
  ],
  reference_map: null,
  ranges: [],
  environment: {
    timestamp_ms: 0,
    temperature_c: 0,
    pressure_hpa: 0,
    relative_altitude_m: 0,
    visibility_score: 0,
    visibility_state: "VERY_LOW",
    mode: "SIMULATED",
  },
  live_objects: [],
  emergency: {
    state: "SAFE",
    reason: null,
    nearest_obstacle_m: null,
    motor_cut: false,
  },
  sensor_health: [],
  safe_corridor: {
    state: "GREY",
    polygon: [],
    exclusions: [],
    confidence: 0,
    reason: "No telemetry received",
  },
  spatial_points: [],
};
