import type { MapFeature, Point2D } from "../types";
import { crusherLayout } from "./crusherLayout";

export function insidePolygon(x: number, y: number, points: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (a.y_m > y !== b.y_m > y &&
      x < ((b.x_m - a.x_m) * (y - a.y_m)) / (b.y_m - a.y_m) + a.x_m)
      inside = !inside;
  }
  return inside;
}

export function edgeDistance(x: number, y: number, points: Point2D[]): number {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    const dx = b.x_m - a.x_m, dy = b.y_m - a.y_m;
    const t = Math.max(0, Math.min(1,
      ((x - a.x_m) * dx + (y - a.y_m) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - a.x_m - t * dx, y - a.y_m - t * dy));
  }
  return best;
}

export function grain(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (grain(ix, iy) * (1 - u) + grain(ix + 1, iy) * u) * (1 - v) +
    (grain(ix, iy + 1) * (1 - u) + grain(ix + 1, iy + 1) * u) * v;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
function smooth(a: number, b: number, value: number) {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface GradedRoad {
  points: Point2D[];
  elevations: number[];
  width: number;
}

export function gradedRoads(features: MapFeature[]): GradedRoad[] {
  return features.filter((f) => ["bench-road", "haul-grade"].includes(String(f.properties.cartography)))
    .flatMap((f) => {
      let heights: unknown = f.properties.elevations_m;
      if (typeof heights === "string") {
        try { heights = JSON.parse(heights); } catch { return []; }
      }
      if (!Array.isArray(heights) || heights.length !== f.points.length ||
        !heights.every((h) => typeof h === "number" && Number.isFinite(h))) return [];
      return [{ points: f.points, elevations: heights as number[],
        width: Math.max(1, Number(f.properties.width_m) || 3) }];
    });
}

interface Segment {
  ax: number; ay: number; dx: number; dy: number; length2: number;
  h: number; dh: number; width: number;
}

// Only nearby segments are sampled by the terrain grid and the moving vehicles.
function roadIndex(roads: GradedRoad[]) {
  const cells = new Map<string, Segment[]>(), cellSize = 8;
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    const segment: Segment = { ax: a.x_m, ay: a.y_m, dx: b.x_m - a.x_m,
      dy: b.y_m - a.y_m, length2: (b.x_m - a.x_m) ** 2 + (b.y_m - a.y_m) ** 2,
      h: road.elevations[i - 1], dh: road.elevations[i] - road.elevations[i - 1], width: road.width };
    const margin = road.width / 2 + 3;
    for (let x = Math.floor((Math.min(a.x_m, b.x_m) - margin) / cellSize);
      x <= Math.floor((Math.max(a.x_m, b.x_m) + margin) / cellSize); x++)
      for (let y = Math.floor((Math.min(a.y_m, b.y_m) - margin) / cellSize);
        y <= Math.floor((Math.max(a.y_m, b.y_m) + margin) / cellSize); y++) {
        const key = `${x},${y}`, cell = cells.get(key);
        if (cell) cell.push(segment); else cells.set(key, [segment]);
      }
  }
  return (x: number, y: number) => {
    let distance = Infinity, elevation = 0, width = 3;
    for (const s of cells.get(`${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`) ?? []) {
      const t = clamp(((x - s.ax) * s.dx + (y - s.ay) * s.dy) / (s.length2 || 1));
      const d = Math.hypot(x - s.ax - t * s.dx, y - s.ay - t * s.dy);
      if (d < distance) { distance = d; elevation = s.h + t * s.dh; width = s.width; }
    }
    return { distance, elevation, width };
  };
}

function polygon(feature: MapFeature) {
  const xs = feature.points.map((p) => p.x_m), ys = feature.points.map((p) => p.y_m);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { feature, contains: (x: number, y: number) =>
    x >= minX && x <= maxX && y >= minY && y <= maxY && insidePolygon(x, y, feature.points) };
}

/** Visual heights never replace backend localization or safety geometry. */
export function createTerrainField(features: MapFeature[]) {
  const roads = features.filter((f) => f.feature_type === "ROAD" &&
    f.properties.cartography !== "graded-access").map(polygon);
  const pits = features.filter((f) => f.properties.cartography === "pit").map(polygon);
  const benches = features.filter((f) => f.properties.cartography === "bench").map(polygon);
  const sites = features.filter((f) => f.geometry_type === "POINT" &&
    f.properties.cartography !== "pit-floor" &&
    f.properties.cartography !== "pit-loading").map((f) => f.points[0]).filter(Boolean);
  const crusher = features.find((f) => f.feature_type === "DESTINATION")?.points[0];
  const station = crusherLayout(features);
  const ramps = roadIndex(gradedRoads(features));
  const roadEdges = roadIndex(roads.map(({ feature }) => ({
    points: [...feature.points, feature.points[0]], elevations: feature.points.map(() => 8).concat(8), width: 12,
  })));
  return (x: number, y: number) => {
    const pit = pits.some((p) => p.contains(x, y));
    const activeRoad = roads.some((r, i) => r.contains(x, y) && (i > 0 || !pit));
    const nearestRamp = ramps(x, y), edge = roadEdges(x, y).distance;
    const ramp = nearestRamp.distance <= nearestRamp.width / 2;
    const broad = noise(x * 0.027, y * 0.027), fine = noise(x * 1.9, y * 1.9);
    const grade = 8 + y * 0.009 + x * 0.004;
    let level = 0, benchElevation = grade, face = 0;
    if (pit) {
      benchElevation = 7.7;
      for (let i = 0; i < benches.length; i++) {
        const b = benches[i];
        if (!b.contains(x, y)) continue;
        level = Number(b.feature.properties.level) || i + 1;
        const height = Number(b.feature.properties.elevation_m);
        const target = Number.isFinite(height) ? height : 8 - level * 2.4;
        const inset = edgeDistance(x, y, b.feature.points);
        face = 1 - smooth(0.08, 0.82, inset);
        benchElevation = mix(target, target + 2.4, face);
      }
    }
    const ridges = 1 - Math.abs(noise(x * 0.012 + 7, y * 0.017) * 2 - 1);
    const ridgeWest = 28 * Math.exp(-((x + 106) ** 2 / 5000 + (y - 70) ** 2 / 19000));
    const hill = 5 + broad * 18 + ridges * ridges * 15 + ridgeWest + noise(x * 0.12, y * 0.12) * 2;
    const shoulder = smooth(0.8, 11, edge);
    let elevation = pit ? benchElevation + (fine - 0.5) * (face > 0.1 ? 0.45 : 0.1)
      : grade + shoulder * hill;
    let pad = sites.some((p) => Math.hypot(x - p.x_m, y - p.y_m) < 5.5);
    let industrial = false;
    if (activeRoad || pad) elevation = grade + (fine - 0.5) * 0.025;
    if (crusher) {
      const dx = x - (station.x + 7), dy = y - station.y;
      const plantDistance = Math.max(Math.abs(dx - 10) - 12, Math.abs(dy - 1) - 13);
      if (plantDistance < 7) {
        elevation = mix(grade, elevation, smooth(0, 7, plantDistance));
        if (plantDistance <= 0) { pad = true; industrial = true; }
      }
      const lowerDistance = Math.max(Math.abs(dx - 78) - 26, Math.abs(dy - (-54)) - 22);
      if (lowerDistance < 24) {
        elevation = mix(-8 + (fine - 0.5) * 0.06, elevation, smooth(0, 24, lowerDistance));
        if (lowerDistance <= 0) { pad = true; industrial = true; }
      }
      const t = clamp(((dx - 6.2) * 71.8 + (dy - (-1.5)) * (-52.5)) / (71.8 * 71.8 + 52.5 * 52.5));
      const conveyorDistance = Math.hypot(dx - 6.2 - t * 71.8, dy - (-1.5) - t * (-52.5));
      if (conveyorDistance < 6) {
        const corridorHeight = mix(8.5, -7.5, t);
        elevation = mix(Math.min(elevation, corridorHeight), elevation, smooth(2.2, 6, conveyorDistance));
        if (conveyorDistance < 3.2) { pad = true; industrial = true; }
      }
    }
    if (nearestRamp.distance < nearestRamp.width / 2 + 1.5) {
      const blend = smooth(nearestRamp.width / 2, nearestRamp.width / 2 + 1.5, nearestRamp.distance);
      elevation = mix(nearestRamp.elevation + 0.03, elevation, blend);
    }
    if (crusher && station.onApron(x, y)) {
      elevation = station.elevation;
      pad = true;
      industrial = true;
    }
    if (crusher && station.inPocket(x, y)) {
      elevation = station.elevation - 3.6;
      pad = true;
      industrial = true;
    }
    return { elevation, road: activeRoad || ramp, pit, level, edge: Math.min(edge,
      nearestRamp.distance - nearestRamp.width / 2), pad, industrial, face,
      variation: broad * 0.7 + fine * 0.3 };
  };
}

export type TerrainField = ReturnType<typeof createTerrainField>;
