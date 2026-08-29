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

export type ThreatLevel = "ALERT" | "CAUTION" | "CLEAR" | "UNKNOWN";

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

/**
 * Calculates realistic visual obstacle size based on distance from sensor/vehicle.
 * Nearer objects appear significantly larger (optical perspective scaling),
 * expanding into high-prominence hazard discs when close.
 */
export function obstacleVisualRadius(distanceM: number, scale: number = 1): number {
  const clampedDist = Math.max(0.18, distanceM);
  const proximityFactor = 3.6 / (clampedDist + 0.42);
  const radius = Math.min(26, Math.max(3.2, 4.4 * proximityFactor * scale));
  return Number(radius.toFixed(2));
}

/**
 * Calculates threat level for a sensor reading against its configured alert threshold.
 */
export function getSensorThreatLevel(
  reading: RangeReading | undefined,
  setting: SensorDisplaySetting,
): ThreatLevel {
  if (!reading || !reading.is_valid) return "UNKNOWN";
  if (reading.range_m <= setting.alert_distance_m) return "ALERT";
  if (reading.range_m <= setting.alert_distance_m * 1.5) return "CAUTION";
  return "CLEAR";
}

/**
 * Generates an SVG path string for a sensor FOV cone/sector on the ground plane.
 */
export function generateFovSectorPath(
  origin: VehiclePoint3D,
  yawDeg: number,
  fovDeg: number,
  rangeM: number,
  segments: number = 8,
): string {
  const halfFov = fovDeg / 2;
  const startAngle = yawDeg - halfFov;
  const step = fovDeg / segments;

  const originScreen = projectVehiclePoint({ x_m: origin.x_m, y_m: origin.y_m, z_m: 0 });
  const points: Array<{ x: number; y: number }> = [originScreen];

  for (let i = 0; i <= segments; i++) {
    const angle = ((startAngle + i * step) * Math.PI) / 180;
    const worldX = origin.x_m + Math.sin(angle) * rangeM;
    const worldY = origin.y_m + Math.cos(angle) * rangeM;
    const screen = projectVehiclePoint({ x_m: worldX, y_m: worldY, z_m: 0 });
    points.push(screen);
  }

  return points.reduce((acc, pt, idx) => {
    if (idx === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    return `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, "") + " Z";
}

