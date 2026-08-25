import type { SpatialPoint, VehiclePose, VisibilityState } from "../types";

export { isUsableRangeReading, usableRangeReadings } from "../state/rangeReadings";

export type AwarenessMode = "AUTO" | "CAMERA" | "TOF_OVERLAY";

export function shouldShowTofOverlay(
  mode: AwarenessMode,
  visibilityState: VisibilityState,
): boolean {
  if (mode === "TOF_OVERLAY") {
    return true;
  }
  if (mode === "CAMERA") {
    return false;
  }
  return visibilityState === "LOW" || visibilityState === "VERY_LOW";
}

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
