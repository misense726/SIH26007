import { describe, expect, it } from "vitest";
import type { RangeReading, SpatialPoint, VehiclePose } from "../types";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import { rangeEndpoint, worldPointToVehicle } from "./spatialProjection";

const vehicle: VehiclePose = {
  timestamp_ms: 1,
  vehicle_id: "DUMPER_01",
  x_m: 4,
  y_m: 8,
  heading_deg: 90,
  speed_mps: 0,
  position_confidence: 1,
  mode: "LIVE",
};

const point: SpatialPoint = {
  timestamp_ms: 1,
  source_sensor_id: "front_scanner",
  x_m: 5,
  y_m: 8,
  height_hint_m: 0.4,
  quality: 1,
};

describe("spatial display projection", () => {
  it("converts world points into the vehicle frame", () => {
    const local = worldPointToVehicle(point, vehicle);
    expect(local.x_m).toBeCloseTo(0);
    expect(local.y_m).toBeCloseTo(1);
    expect(local.z_m).toBeCloseTo(0.4);
  });

  it("follows the scanner head angle from telemetry", () => {
    const setting: SensorDisplaySetting = {
      sensor_id: "front_scanner",
      label: "Front scanner",
      scanner: true,
      display_pose: { x_m: 0, y_m: 0.5, z_m: 0.2, yaw_deg: 0, pitch_deg: 0 },
      alert_distance_m: 0.8,
      visual_range_m: 4,
    };
    const reading: RangeReading = {
      timestamp_ms: 1,
      sensor_id: "front_scanner",
      angle_deg: 90,
      range_m: 2,
      quality: 1,
      max_range_m: 4,
      is_valid: true,
      mode: "LIVE",
    };
    const endpoint = rangeEndpoint(setting, reading);
    expect(endpoint.x_m).toBeCloseTo(2);
    expect(endpoint.y_m).toBeCloseTo(0.5);
  });

  it("uses the configured yaw for a fixed sensor", () => {
    const setting: SensorDisplaySetting = {
      sensor_id: "left_side",
      label: "Left fixed",
      scanner: false,
      display_pose: { x_m: -0.3, y_m: 0, z_m: 0.2, yaw_deg: -90, pitch_deg: 0 },
      alert_distance_m: 0.5,
      visual_range_m: 2,
    };
    const endpoint = rangeEndpoint(setting, undefined);
    expect(endpoint.x_m).toBeLessThan(-0.8);
    expect(endpoint.y_m).toBeCloseTo(0);
  });
});
