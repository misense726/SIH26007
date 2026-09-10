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

export interface ImuOrientation {
  pitch_deg: number; // Nose up (positive) / down (negative)
  roll_deg: number;  // Bank right (positive) / left (negative)
  yaw_deg: number;   // Heading yaw offset
  suspension_z_m?: number;
}

export interface CameraViewConfig {
  orbitYawDeg?: number;
  cameraPitchDeg?: number;
  zoomScale?: number;
  panOffsetX?: number;
  panOffsetY?: number;
}

export const CAMERA_ORBIT_MIN_DEG = 0;
export const CAMERA_ORBIT_MAX_DEG = 359;
export const DEFAULT_CAMERA_PITCH_DEG = 69;
export const CAMERA_PITCH_MIN_DEG = -85;
export const CAMERA_PITCH_MAX_DEG = 85;

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function finiteVehiclePoint(point: VehiclePoint3D): VehiclePoint3D {
  return {
    x_m: finiteNumber(point.x_m, 0),
    y_m: finiteNumber(point.y_m, 0),
    z_m: finiteNumber(point.z_m, 0),
  };
}

export function cameraOrbitAfterDrag(
  currentOrbitDeg: number,
  horizontalDeltaPx: number,
  degreesPerPixel: number = 0.3,
): number {
  const nextOrbitDeg =
    finiteNumber(currentOrbitDeg, 0) +
    finiteNumber(horizontalDeltaPx, 0) * finiteNumber(degreesPerPixel, 0.3);
  return ((nextOrbitDeg % 360) + 360) % 360;
}

export function cameraPitchAfterDrag(
  currentPitchDeg: number,
  verticalDeltaPx: number,
  degreesPerPixel: number = 0.25,
): number {
  const nextPitchDeg =
    finiteNumber(currentPitchDeg, DEFAULT_CAMERA_PITCH_DEG) -
    finiteNumber(verticalDeltaPx, 0) * finiteNumber(degreesPerPixel, 0.25);
  return Math.max(CAMERA_PITCH_MIN_DEG, Math.min(CAMERA_PITCH_MAX_DEG, nextPitchDeg));
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

/**
 * Transforms a 3D point in the vehicle body frame by MPU-6050 IMU attitude (pitch, roll, yaw).
 */
export function applyImuTransform(
  point: VehiclePoint3D,
  imu: ImuOrientation = { pitch_deg: 0, roll_deg: 0, yaw_deg: 0 },
  origin: VehiclePoint3D = { x_m: 0, y_m: 0, z_m: 0 },
): VehiclePoint3D {
  const safePoint = finiteVehiclePoint(point);
  const safeOrigin = finiteVehiclePoint(origin);
  const pRad = (finiteNumber(imu.pitch_deg, 0) * Math.PI) / 180;
  const rRad = (finiteNumber(imu.roll_deg, 0) * Math.PI) / 180;
  const yRad = (finiteNumber(imu.yaw_deg, 0) * Math.PI) / 180;

  const dx = safePoint.x_m - safeOrigin.x_m;
  const dy = safePoint.y_m - safeOrigin.y_m;
  const dz = safePoint.z_m - safeOrigin.z_m;

  // 1. Yaw rotation around Z
  const x1 = dx * Math.cos(yRad) + dy * Math.sin(yRad);
  const y1 = -dx * Math.sin(yRad) + dy * Math.cos(yRad);
  const z1 = dz;

  // 2. Pitch rotation around X
  const x2 = x1;
  const y2 = y1 * Math.cos(pRad) - z1 * Math.sin(pRad);
  const z2 = y1 * Math.sin(pRad) + z1 * Math.cos(pRad);

  // 3. Roll rotation around Y
  const x3 = x2 * Math.cos(rRad) + z2 * Math.sin(rRad);
  const y3 = y2;
  const z3 = -x2 * Math.sin(rRad) + z2 * Math.cos(rRad);

  return {
    x_m: safeOrigin.x_m + x3,
    y_m: safeOrigin.y_m + y3,
    z_m: Math.max(
      0,
      safeOrigin.z_m + z3 + finiteNumber(imu.suspension_z_m, 0),
    ),
  };
}

export function cameraDepthForVehiclePoint(
  point: VehiclePoint3D,
  camera: CameraViewConfig = {},
): number {
  const safePoint = finiteVehiclePoint(point);
  const yawDeg = finiteNumber(camera.orbitYawDeg, 0);
  const pitchDeg = Math.max(
    CAMERA_PITCH_MIN_DEG,
    Math.min(
      CAMERA_PITCH_MAX_DEG,
      finiteNumber(camera.cameraPitchDeg, DEFAULT_CAMERA_PITCH_DEG),
    ),
  );
  const yawRad = (yawDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const rotatedY =
    safePoint.x_m * Math.sin(yawRad) + safePoint.y_m * Math.cos(yawRad);

  return rotatedY * Math.cos(pitchRad) - safePoint.z_m * Math.sin(pitchRad);
}

export function projectVehiclePointWithCamera(
  point: VehiclePoint3D,
  camera: CameraViewConfig = {},
): ScreenPoint {
  const safePoint = finiteVehiclePoint(point);
  const yawRad = (finiteNumber(camera.orbitYawDeg, 0) * Math.PI) / 180;
  const pitchDeg = Math.max(
    CAMERA_PITCH_MIN_DEG,
    Math.min(
      CAMERA_PITCH_MAX_DEG,
      finiteNumber(camera.cameraPitchDeg, DEFAULT_CAMERA_PITCH_DEG),
    ),
  );
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const steepViewProgress = Math.max(
    0,
    (Math.abs(pitchDeg) - DEFAULT_CAMERA_PITCH_DEG) /
      (CAMERA_PITCH_MAX_DEG - DEFAULT_CAMERA_PITCH_DEG),
  );
  const zoom = Math.max(0.2, Math.min(4, finiteNumber(camera.zoomScale, 1))) *
    (1 - steepViewProgress * 0.38);
  const panX = finiteNumber(camera.panOffsetX, 0);
  const panY = finiteNumber(camera.panOffsetY, 0);

  const rotatedX =
    safePoint.x_m * Math.cos(yawRad) - safePoint.y_m * Math.sin(yawRad);
  const rotatedY =
    safePoint.x_m * Math.sin(yawRad) + safePoint.y_m * Math.cos(yawRad);

  const cameraDepth = cameraDepthForVehiclePoint(safePoint, camera);
  const forward = Math.max(-4, Math.min(6, cameraDepth));
  const scale = (1 / (1 + Math.max(0, forward + 0.5) * 0.055)) * zoom;

  return {
    x: 500 + panX + rotatedX * 96 * scale,
    y:
      400 +
      panY -
      rotatedY * 96 * Math.sin(pitchRad) * zoom -
      safePoint.z_m * 88 * Math.cos(pitchRad) * scale,
    scale,
  };
}

export function projectVehiclePoint(point: VehiclePoint3D): ScreenPoint {
  return projectVehiclePointWithCamera(point, {});
}


export function rangeEndpoint(
  setting: SensorDisplaySetting,
  reading: RangeReading | undefined,
): VehiclePoint3D {
  const visualRange = Math.max(0, finiteNumber(setting.visual_range_m, 0));
  const measuredRange = finiteNumber(reading?.range_m, 0.55);
  const range = reading?.is_valid
    ? Math.max(0, Math.min(measuredRange, visualRange))
    : Math.min(0.55, visualRange);
  const yaw =
    finiteNumber(setting.display_pose.yaw_deg, 0) +
    (setting.scanner ? finiteNumber(reading?.angle_deg, 0) : 0);
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (finiteNumber(setting.display_pose.pitch_deg, 0) * Math.PI) / 180;
  const planarRange = range * Math.cos(pitchRad);
  return {
    x_m: finiteNumber(setting.display_pose.x_m, 0) + Math.sin(yawRad) * planarRange,
    y_m: finiteNumber(setting.display_pose.y_m, 0) + Math.cos(yawRad) * planarRange,
    z_m: Math.max(
      0,
      finiteNumber(setting.display_pose.z_m, 0) + Math.sin(pitchRad) * range,
    ),
  };
}

export function pointDistanceFromSensor(
  point: VehiclePoint3D,
  setting: SensorDisplaySetting,
): number {
  const safePoint = finiteVehiclePoint(point);
  return Math.hypot(
    safePoint.x_m - finiteNumber(setting.display_pose.x_m, 0),
    safePoint.y_m - finiteNumber(setting.display_pose.y_m, 0),
    safePoint.z_m - finiteNumber(setting.display_pose.z_m, 0),
  );
}

/**
 * Calculates realistic visual obstacle size based on distance from sensor/vehicle.
 * Nearer objects appear significantly larger (optical perspective scaling),
 * expanding into high-prominence hazard discs when close.
 */
export function obstacleVisualRadius(distanceM: number, scale: number = 1): number {
  const clampedDist = Math.max(0.18, finiteNumber(distanceM, 4));
  const proximityFactor = 3.6 / (clampedDist + 0.42);
  const radius = Math.min(
    26,
    Math.max(3.2, 4.4 * proximityFactor * Math.max(0, finiteNumber(scale, 1))),
  );
  return Number(radius.toFixed(2));
}

/**
 * Calculates threat level for a sensor reading against its configured alert threshold.
 */
export function getSensorThreatLevel(
  reading: RangeReading | undefined,
  setting: SensorDisplaySetting,
): ThreatLevel {
  if (!reading || !reading.is_valid || !Number.isFinite(reading.range_m)) return "UNKNOWN";
  const alertDistance = Math.max(0, finiteNumber(setting.alert_distance_m, 0));
  if (reading.range_m <= alertDistance) return "ALERT";
  if (reading.range_m <= alertDistance * 1.5) return "CAUTION";
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
  cameraConfig: CameraViewConfig = {},
): string {
  const halfFov = fovDeg / 2;
  const startAngle = yawDeg - halfFov;
  const step = fovDeg / segments;

  const originScreen = projectVehiclePointWithCamera(
    { x_m: origin.x_m, y_m: origin.y_m, z_m: 0 },
    cameraConfig,
  );
  const points: Array<{ x: number; y: number }> = [originScreen];

  for (let i = 0; i <= segments; i++) {
    const angle = ((startAngle + i * step) * Math.PI) / 180;
    const worldX = origin.x_m + Math.sin(angle) * rangeM;
    const worldY = origin.y_m + Math.cos(angle) * rangeM;
    const screen = projectVehiclePointWithCamera(
      { x_m: worldX, y_m: worldY, z_m: 0 },
      cameraConfig,
    );
    points.push(screen);
  }

  return points.reduce((acc, pt, idx) => {
    if (idx === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    return `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, "") + " Z";
}
