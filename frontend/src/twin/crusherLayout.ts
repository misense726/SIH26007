import type { MapFeature } from "../types";

/** Backend docking coordinates anchor the building, pocket and ore stream. */
export function crusherLayout(features: MapFeature[]) {
  const destination = features.find((f) => f.feature_type === "DESTINATION");
  const point = destination?.points[0] ?? { x_m: 32, y_m: 44 };
  const props = destination?.properties ?? {};
  const x = Number(props.dock_x_m ?? point.x_m + 5);
  const y = Number(props.dock_y_m ?? point.y_m - 4);
  const elevation = Number(props.dock_elevation_m ?? 8 + point.y_m * 0.009 + point.x_m * 0.004);
  return { x, y, elevation, pocketX: x + 4, pocketY: y,
    inPocket: (px: number, py: number) => px > x + 1.55 && px < x + 6.45 && Math.abs(py - y) < 2.35,
    onApron: (px: number, py: number) => px > x - 5.5 && px < x + 8 && Math.abs(py - y) < 4.2 };
}
