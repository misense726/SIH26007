import type { MapFeature } from "../types";

export function planBounds(features: MapFeature[]) {
  const points = features
    .filter((f) => f.properties.cartography !== "contour")
    .flatMap((f) => f.points);
  if (!points.length) return { x: 0, y: 0, width: 40, height: 40 };
  const xs = points.map((p) => p.x_m),
    ys = points.map((p) => p.y_m);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    width: Math.max(20, maxX - minX),
    height: Math.max(20, maxY - minY),
  };
}

export function scaleDistance(pixelsPerMetre: number) {
  const target = 90 / pixelsPerMetre;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return (
    [5, 2, 1].map((n) => n * magnitude).find((n) => n <= target) ?? magnitude
  );
}

export interface PlanLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}
export function placeLabels(
  labels: PlanLabel[],
  width: number,
  height: number,
) {
  const occupied: {
    left: number;
    top: number;
    width: number;
    height: number;
  }[] = labels.map((label) => ({
    left: label.x - 16,
    top: label.y - 18,
    width: 32,
    height: 36,
  }));
  return labels.map((label) => {
    const w = Math.min(width - 24, label.text.length * 7 + 20),
      h = 26;
    const candidates = [
      [20, -13],
      [-w - 20, -13],
      [-w / 2, -43],
      [-w / 2, 22],
      [20, -57],
      [-w - 20, 38],
      [20, 52],
      [-w - 20, -72],
    ];
    const score = (box: (typeof occupied)[number]) =>
      occupied.reduce(
        (total, other) =>
          total +
          Math.max(
            0,
            Math.min(box.left + w + 4, other.left + other.width) -
              Math.max(box.left - 4, other.left),
          ) *
            Math.max(
              0,
              Math.min(box.top + h + 4, other.top + other.height) -
                Math.max(box.top - 4, other.top),
            ),
        0,
      );
    const boxes = candidates.map(([dx, dy]) => ({
      left: Math.max(8, Math.min(width - w - 8, label.x + dx)),
      top: Math.max(48, Math.min(height - h - 50, label.y + dy)),
      width: w,
      height: h,
    }));
    const box = boxes.reduce((best, candidate) =>
      score(candidate) < score(best) ? candidate : best,
    );
    occupied.push(box);
    return { ...label, ...box };
  });
}
