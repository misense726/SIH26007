import type { SpatialPoint, VehiclePose } from "../types";

export { isUsableRangeReading, usableRangeReadings } from "../state/rangeReadings";

export type AwarenessMode = "CAMERA" | "LIDAR";
export const DEFAULT_AWARENESS_MODE: AwarenessMode = "CAMERA";

export function spatialPointToPlot(
  point: SpatialPoint,
  vehicle: VehiclePose,
): { x: number; y: number; distance_m: number } {
  const heading = (vehicle.heading_deg * Math.PI) / 180;
  const deltaX = point.x_m - vehicle.x_m;
  const deltaY = point.y_m - vehicle.y_m;
  const localX = deltaX * Math.cos(heading) - deltaY * Math.sin(heading);
  const localY = deltaX * Math.sin(heading) + deltaY * Math.cos(heading);
  const distance = Math.hypot(localX, localY);

  return {
    x: 120 + localX * 22,
    y: 120 - localY * 22,
    distance_m: distance,
  };
}
