import type { Point2D, VehiclePose } from "../types";
import type { VehiclePoint3D } from "./spatialProjection";

export function localPoint(
  point: Point2D,
  vehicle: VehiclePose,
  z_m = 0,
): VehiclePoint3D {
  const angle = (vehicle.heading_deg * Math.PI) / 180;
  const x = point.x_m - vehicle.x_m;
  const y = point.y_m - vehicle.y_m;
  return {
    x_m: x * Math.cos(angle) - y * Math.sin(angle),
    y_m: x * Math.sin(angle) + y * Math.cos(angle),
    z_m,
  };
}

/** Bound road polygons before projection so offscreen geometry stays small. */
export function clipRoad(
  points: VehiclePoint3D[],
  radius = 11,
): VehiclePoint3D[] {
  let result = points;
  for (const [axis, boundary, sign] of [
    ["x_m", -radius, 1],
    ["x_m", radius, -1],
    ["y_m", -radius, 1],
    ["y_m", radius, -1],
  ] as const) {
    const input = result;
    result = [];
    if (input.length === 0) break;
    let previous = input[input.length - 1];
    for (const current of input) {
      const inside = sign * (current[axis] - boundary) >= 0;
      const wasInside = sign * (previous[axis] - boundary) >= 0;
      if (inside !== wasInside) {
        const t =
          (boundary - previous[axis]) / (current[axis] - previous[axis]);
        result.push({
          x_m: previous.x_m + t * (current.x_m - previous.x_m),
          y_m: previous.y_m + t * (current.y_m - previous.y_m),
          z_m: 0,
          [axis]: boundary,
        });
      }
      if (inside) result.push(current);
      previous = current;
    }
  }
  return result;
}
