import type { MapFeature, Point2D } from "../types";

export function insidePolygon(
  x: number,
  y: number,
  points: Point2D[],
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a.y_m > y !== b.y_m > y &&
      x < ((b.x_m - a.x_m) * (y - a.y_m)) / (b.y_m - a.y_m) + a.x_m
    )
      inside = !inside;
  }
  return inside;
}

export function edgeDistance(x: number, y: number, points: Point2D[]): number {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j],
      dx = b.x_m - a.x_m,
      dy = b.y_m - a.y_m;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - a.x_m) * dx + (y - a.y_m) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    best = Math.min(best, Math.hypot(x - a.x_m - t * dx, y - a.y_m - t * dy));
  }
  return best;
}

export function grain(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  return (
    (grain(ix, iy) * (1 - u) + grain(ix + 1, iy) * u) * (1 - v) +
    (grain(ix, iy + 1) * (1 - u) + grain(ix + 1, iy + 1) * u) * v
  );
}

/** Visual elevation only. Backend map polygons still own route and safety geometry. */
export function createTerrainField(features: MapFeature[]) {
  const roads = features.filter((f) => f.feature_type === "ROAD");
  const pits = features.filter((f) => f.properties.cartography === "pit");
  const benches = features.filter((f) => f.properties.cartography === "bench");
  const sites = features
    .filter((f) => f.geometry_type === "POINT")
    .map((f) => f.points[0]);
  const crusher = features.find((f) => f.feature_type === "DESTINATION")
    ?.points[0];
  return (x: number, y: number) => {
    const pit = pits.some((f) => insidePolygon(x, y, f.points));
    const road = roads.some(
      (f, i) => insidePolygon(x, y, f.points) && (i > 0 || !pit),
    );
    const grade = 5 + y * 0.045 + x * 0.018;
    let level = 0;
    if (pit)
      benches.forEach((f, i) => {
        if (insidePolygon(x, y, f.points)) level = i + 1;
      });
    const edge = roads.length
      ? Math.min(...roads.map((f) => edgeDistance(x, y, f.points)))
      : 20;
    const plantPad = Boolean(
      crusher &&
        x > crusher.x_m &&
        x < crusher.x_m + 27 &&
        y > crusher.y_m - 20 &&
        y < crusher.y_m + 8,
    );
    const pad =
      plantPad || sites.some((p) => Math.hypot(x - p.x_m, y - p.y_m) < 7);
    const broad = noise(x * 0.065, y * 0.065),
      fine = noise(x * 1.7, y * 1.7);
    const elevation =
      road || pad
        ? grade + fine * 0.045
        : pit
          ? grade - 2.4 - level * 2.2 + (fine - 0.5) * 0.32
          : grade +
            Math.min(1, edge / 6) *
              (2 + 10 * broad + 2 * noise(x * 0.21, y * 0.21));
    return {
      elevation,
      road,
      pit,
      level,
      edge,
      pad,
      variation: broad * 0.7 + fine * 0.3,
    };
  };
}

export type TerrainField = ReturnType<typeof createTerrainField>;
