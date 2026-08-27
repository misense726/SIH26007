import type { RangeReading, SpatialPoint, VehiclePose } from "../types";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";

export interface VehiclePoint3D {
  x_m: number;
  y_m: number;
  z_m: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  scale: number;
}

export function worldPointToVehicle(
  point: SpatialPoint,
  vehicle: VehiclePose,
): VehiclePoint3D {
  const heading = (vehicle.heading_deg * Math.PI) / 180;
  const deltaX = point.x_m - vehicle.x_m;
  const deltaY = point.y_m - vehicle.y_m;
  return {
    x_m: deltaX * Math.cos(heading) - deltaY * Math.sin(heading),
    y_m: deltaX * Math.sin(heading) + deltaY * Math.cos(heading),
    z_m: Math.max(0, point.height_hint_m),
  };
}

export function projectVehiclePoint(point: VehiclePoint3D): ScreenPoint {
  const forward = Math.max(-4, Math.min(6, point.y_m));
  const scale = 1 / (1 + Math.max(0, forward + 0.5) * 0.055);
  return {
    x: 500 + point.x_m * 96 * scale,
    y: 452 - point.y_m * 55 - point.z_m * 72 * scale,
    scale,
  };
}

export function rangeEndpoint(
  setting: SensorDisplaySetting,
  reading: RangeReading | undefined,
): VehiclePoint3D {
  const range = reading?.is_valid
    ? Math.min(reading.range_m, setting.visual_range_m)
    : Math.min(0.55, setting.visual_range_m);
  const yaw = setting.display_pose.yaw_deg + (setting.scanner ? reading?.angle_deg ?? 0 : 0);
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (setting.display_pose.pitch_deg * Math.PI) / 180;
  const planarRange = range * Math.cos(pitchRad);
  return {
    x_m: setting.display_pose.x_m + Math.sin(yawRad) * planarRange,
    y_m: setting.display_pose.y_m + Math.cos(yawRad) * planarRange,
    z_m: Math.max(0, setting.display_pose.z_m + Math.sin(pitchRad) * range),
  };
}

export function pointDistanceFromSensor(
  point: VehiclePoint3D,
  setting: SensorDisplaySetting,
): number {
  return Math.hypot(
    point.x_m - setting.display_pose.x_m,
    point.y_m - setting.display_pose.y_m,
    point.z_m - setting.display_pose.z_m,
  );
}
