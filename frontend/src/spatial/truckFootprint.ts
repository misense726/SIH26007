import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import type { VehiclePoint3D } from "./spatialProjection";
import { buildTruckMesh } from "./truckMesh";

export interface TruckFootprint {
  left: number;
  right: number;
  front: number;
  rear: number;
}

const vertices = buildTruckMesh().flatMap((surface) => surface.points);
const MODEL_FOOTPRINT: TruckFootprint = {
  left: Math.min(...vertices.map((p) => p.x_m)),
  right: Math.max(...vertices.map((p) => p.x_m)),
  front: Math.max(...vertices.map((p) => p.y_m)),
  rear: Math.min(...vertices.map((p) => p.y_m)),
};

export function truckDisplayGeometry(sensors: SensorDisplaySetting[], fitToSensors = true) {
  const mounts = sensors.map((sensor) => sensor.display_pose);
  const limits = [
    Math.min(0, ...mounts.map((p) => p.x_m)) / MODEL_FOOTPRINT.left,
    Math.max(0, ...mounts.map((p) => p.x_m)) / MODEL_FOOTPRINT.right,
    Math.max(0, ...mounts.map((p) => p.y_m)) / MODEL_FOOTPRINT.front,
    Math.min(0, ...mounts.map((p) => p.y_m)) / MODEL_FOOTPRINT.rear,
  ].filter((value) => Number.isFinite(value) && value > 0);
  const scale = fitToSensors ? Math.min(1, ...limits) : 1;
  return {
    scale,
    footprint: {
      left: MODEL_FOOTPRINT.left * scale,
      right: MODEL_FOOTPRINT.right * scale,
      front: MODEL_FOOTPRINT.front * scale,
      rear: MODEL_FOOTPRINT.rear * scale,
    },
  };
}

export function clearanceFromPerimeter(
  point: VehiclePoint3D,
  footprint: TruckFootprint,
): number {
  const dx = Math.max(footprint.left - point.x_m, 0, point.x_m - footprint.right);
  const dy = Math.max(footprint.rear - point.y_m, 0, point.y_m - footprint.front);
  return Math.hypot(dx, dy);
}

/** Rounded offsets have the same clearance from both the edges and corners. */
export function perimeterRingPoints(footprint: TruckFootprint, clearanceM: number): VehiclePoint3D[] {
  const distance = Math.max(0, clearanceM);
  return [
    { x: footprint.right, y: footprint.front, start: 0 },
    { x: footprint.left, y: footprint.front, start: 90 },
    { x: footprint.left, y: footprint.rear, start: 180 },
    { x: footprint.right, y: footprint.rear, start: 270 },
  ].flatMap(({ x, y, start }) => Array.from({ length: 9 }, (_, i) => {
    const angle = (start + i * 90 / 8) * Math.PI / 180;
    return { x_m: x + distance * Math.cos(angle), y_m: y + distance * Math.sin(angle), z_m: 0 };
  }));
}
