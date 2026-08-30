import { describe, expect, it } from "vitest";
import type { RangeReading, SpatialPoint, VehiclePose } from "../types";
import { defaultSensorSettings, type SensorDisplaySetting } from "../settings/sensorSettingsApi";
import {
  applyImuTransform,
  cameraOrbitAfterDrag,
  cameraPitchAfterDrag,
  generateFovSectorPath,
  getSensorThreatLevel,
  obstacleVisualRadius,
  projectVehiclePointWithCamera,
  rangeEndpoint,
  worldPointToVehicle,
} from "./spatialProjection";

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

  it("keeps the fixed front and side heads pitched down by default", () => {
    const sensors = defaultSensorSettings().sensors;
    const front = sensors.find((sensor) => sensor.sensor_id === "front_fixed");
    const left = sensors.find((sensor) => sensor.sensor_id === "left_side");
    expect(front?.display_pose.pitch_deg).toBe(-50);
    expect(left?.display_pose.pitch_deg).toBe(-50);

    const endpoint = rangeEndpoint(front!, undefined);
    expect(endpoint.z_m).toBeLessThan(front!.display_pose.z_m);
    expect(endpoint.y_m).toBeGreaterThan(front!.display_pose.y_m);
  });

  it("scales visual obstacle radius realistically as objects get nearer", () => {
    const farRadius = obstacleVisualRadius(4.0, 1);
    const midRadius = obstacleVisualRadius(2.0, 1);
    const nearRadius = obstacleVisualRadius(0.8, 1);
    const veryNearRadius = obstacleVisualRadius(0.25, 1);

    expect(farRadius).toBeLessThan(midRadius);
    expect(midRadius).toBeLessThan(nearRadius);
    expect(nearRadius).toBeLessThan(veryNearRadius);
    expect(veryNearRadius).toBeGreaterThan(15);
  });

  it("evaluates sensor threat levels correctly", () => {
    const setting: SensorDisplaySetting = {
      sensor_id: "front_scanner",
      label: "Front scanner",
      scanner: true,
      display_pose: { x_m: 0, y_m: 0.5, z_m: 0.2, yaw_deg: 0, pitch_deg: 0 },
      alert_distance_m: 1.0,
      visual_range_m: 4,
    };

    expect(getSensorThreatLevel(undefined, setting)).toBe("UNKNOWN");
    expect(getSensorThreatLevel({ timestamp_ms: 1, sensor_id: "front_scanner", angle_deg: 0, range_m: 0.6, quality: 1, max_range_m: 4, is_valid: true, mode: "LIVE" }, setting)).toBe("ALERT");
    expect(getSensorThreatLevel({ timestamp_ms: 1, sensor_id: "front_scanner", angle_deg: 0, range_m: 1.3, quality: 1, max_range_m: 4, is_valid: true, mode: "LIVE" }, setting)).toBe("CAUTION");
    expect(getSensorThreatLevel({ timestamp_ms: 1, sensor_id: "front_scanner", angle_deg: 0, range_m: 3.2, quality: 1, max_range_m: 4, is_valid: true, mode: "LIVE" }, setting)).toBe("CLEAR");
  });

  it("generates a closed SVG path for FOV sectors", () => {
    const path = generateFovSectorPath({ x_m: 0, y_m: 0, z_m: 0 }, 0, 30, 2);
    expect(path.startsWith("M ")).toBe(true);
    expect(path.endsWith(" Z")).toBe(true);
  });

  it("projects FOV sectors through the active camera orbit", () => {
    const origin = { x_m: 0, y_m: 0, z_m: 0 };
    const frontView = generateFovSectorPath(origin, 0, 0, 2, 1, { orbitYawDeg: 0 });
    const sideView = generateFovSectorPath(origin, 0, 0, 2, 1, { orbitYawDeg: 90 });

    expect(sideView).not.toBe(frontView);
  });

  it("wraps horizontal pointer movement through a full camera orbit", () => {
    expect(cameraOrbitAfterDrag(0, 120)).toBe(36);
    expect(cameraOrbitAfterDrag(350, 120)).toBe(26);
    expect(cameraOrbitAfterDrag(10, -120)).toBe(334);
  });

  it("clamps vertical pointer movement between side and overhead views", () => {
    expect(cameraPitchAfterDrag(35, -100)).toBe(60);
    expect(cameraPitchAfterDrag(80, -100)).toBe(85);
    expect(cameraPitchAfterDrag(10, 100)).toBe(5);
  });

  it("changes ground depth and vehicle height together with the camera pitch", () => {
    const groundPoint = { x_m: 0, y_m: 2, z_m: 0 };
    const roofPoint = { x_m: 0, y_m: 0, z_m: 1 };
    const sideGround = projectVehiclePointWithCamera(groundPoint, { cameraPitchDeg: 5 });
    const overheadGround = projectVehiclePointWithCamera(groundPoint, { cameraPitchDeg: 85 });
    const sideRoof = projectVehiclePointWithCamera(roofPoint, { cameraPitchDeg: 5 });
    const overheadRoof = projectVehiclePointWithCamera(roofPoint, { cameraPitchDeg: 85 });

    expect(Math.abs(overheadGround.y - 400)).toBeGreaterThan(Math.abs(sideGround.y - 400));
    expect(Math.abs(sideRoof.y - 400)).toBeGreaterThan(Math.abs(overheadRoof.y - 400));
  });

  it("applies MPU-6050 pitch, roll, and yaw transformations accurately", () => {
    const original = { x_m: 0, y_m: 1, z_m: 0.5 };

    // Pitch down by 10 degrees (nose dips forward/downward)
    const pitched = applyImuTransform(original, { pitch_deg: -10, roll_deg: 0, yaw_deg: 0 });
    expect(pitched.x_m).toBeCloseTo(0);
    expect(pitched.z_m).toBeLessThan(0.5); // nose dips down

    // Roll right by 15 degrees (banks right)
    const rolled = applyImuTransform(original, { pitch_deg: 0, roll_deg: 15, yaw_deg: 0 });
    expect(rolled.x_m).toBeGreaterThan(0); // shifts right

    // Yaw 90 degrees
    const yawed = applyImuTransform(original, { pitch_deg: 0, roll_deg: 0, yaw_deg: 90 });
    expect(yawed.x_m).toBeCloseTo(1);
    expect(yawed.y_m).toBeCloseTo(0);
  });

});
