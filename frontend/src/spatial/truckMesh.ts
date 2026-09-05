import type { VehiclePoint3D } from "./spatialProjection";

type Point = VehiclePoint3D;
type Coordinate = [number, number, number];

export interface TruckSurface {
  key: string;
  part: string;
  points: Point[];
  fill: string;
  details: { points: Point[]; fill: string }[];
}

const PAINT = "#d9a441";
const EDGE = "#efc36b";
const STEEL = "#54616b";
const FRAME = "#303940";
const RUBBER = "#303337";
const GLASS = "#294955";

const point = ([x_m, y_m, z_m]: Coordinate): Point => ({ x_m, y_m, z_m });
const subtract = (a: Point, b: Point): Point => ({
  x_m: a.x_m - b.x_m, y_m: a.y_m - b.y_m, z_m: a.z_m - b.z_m,
});

export function surfaceNormal(points: Point[]): Point {
  const a = subtract(points[1], points[0]);
  const b = subtract(points[2], points[0]);
  const normal = {
    x_m: a.y_m * b.z_m - a.z_m * b.y_m,
    y_m: a.z_m * b.x_m - a.x_m * b.z_m,
    z_m: a.x_m * b.y_m - a.y_m * b.x_m,
  };
  const length = Math.hypot(normal.x_m, normal.y_m, normal.z_m) || 1;
  return { x_m: normal.x_m / length, y_m: normal.y_m / length, z_m: normal.z_m / length };
}

function shade(color: string, normal: Point): string {
  const light = Math.max(0, -0.4 * normal.x_m + 0.3 * normal.y_m + 0.86 * normal.z_m);
  const strength = 0.62 + light * 0.48;
  return `#${[1, 3, 5].map((offset) => Math.min(255,
    Math.round(parseInt(color.slice(offset, offset + 2), 16) * strength),
  ).toString(16).padStart(2, "0")).join("")}`;
}

/** Visual body coordinates use the existing display footprint, not sensor calibration. */
export function buildTruckMesh(steerAngleDeg = 0): TruckSurface[] {
  const surfaces: TruckSurface[] = [];
  const face = (part: string, vertices: Coordinate[], color: string): TruckSurface => {
    const points = vertices.map(point);
    const result = {
      key: `${part}-${surfaces.length}`, part, points,
      fill: shade(color, surfaceNormal(points)), details: [],
    };
    surfaces.push(result);
    return result;
  };

  // Each closed extrusion has outward winding, including its bottom and end caps.
  const solid = (part: string, lower: Coordinate[], upper: Coordinate[], color: string) => {
    const center = [...lower, ...upper].reduce(
      (sum, v) => sum.map((n, i) => n + v[i] / (lower.length * 2)) as Coordinate,
      [0, 0, 0] as Coordinate,
    );
    const outward = (vertices: Coordinate[]) => {
      const normal = surfaceNormal(vertices.map(point));
      const delta = subtract(point(vertices[0]), point(center));
      if (normal.x_m * delta.x_m + normal.y_m * delta.y_m + normal.z_m * delta.z_m < 0) vertices.reverse();
      return face(part, vertices, color);
    };
    const bottom = outward([...lower]);
    const top = outward([...upper]);
    const sides = lower.map((v, i) => {
      const next = (i + 1) % lower.length;
      return outward([v, lower[next], upper[next], upper[i]]);
    });
    return { bottom, top, sides };
  };

  const box = (part: string, min: Coordinate, max: Coordinate, color: string) => {
    const [x, y, z] = min;
    const [X, Y, Z] = max;
    return solid(part, [[x, y, z], [X, y, z], [X, Y, z], [x, Y, z]],
      [[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], color);
  };

  // Decals belong to their host face, so glass, seams and bolts never float through it.
  const detail = (host: TruckSurface, vertices: Coordinate[], fill: string) => {
    host.details.push({ points: vertices.map(point), fill });
  };
  const frontPanel = (host: TruckSurface, x: number, X: number, y: number, z: number, Z: number, fill: string) =>
    detail(host, [[x, y, z], [X, y, z], [X, y, Z], [x, y, Z]], fill);

  box("truck-solid-core", [-0.44, -1.29, 0.28], [0.44, 1.12, 0.52], FRAME);
  for (const x of [-0.36, 0.28]) {
    box("truck-undercarriage", [x, -1.3, 0.23], [x + 0.08, 1.12, 0.4], STEEL);
  }
  for (const y of [-0.77, 0.77]) {
    box("truck-undercarriage", [-0.73, y - 0.075, 0.29], [0.73, y + 0.075, 0.4], FRAME);
    box("truck-undercarriage", [-0.15, y - 0.14, 0.23], [0.15, y + 0.14, 0.46], STEEL);
  }
  box("truck-undercarriage", [-0.045, -0.78, 0.26], [0.045, 0.82, 0.33], STEEL);

  const tire = (id: string, x: number, y: number, width: number, radius: number, angle: number) => {
    const radians = angle * Math.PI / 180;
    const transform = (axial: number, longitudinal: number, height: number): Coordinate => [
      x + axial * Math.cos(radians) + longitudinal * Math.sin(radians),
      y - axial * Math.sin(radians) + longitudinal * Math.cos(radians),
      radius + height,
    ];
    const radial = (axial: number, r: number, theta: number): Coordinate =>
      transform(axial, Math.sin(theta) * r, Math.cos(theta) * r);
    const count = 32;
    const ring = (axial: number, r: number) => Array.from({ length: count }, (_, i) => radial(axial, r, i * Math.PI * 2 / count));
    const bands = [
      { x: -width / 2, r: radius * 0.86 },
      { x: -width * 0.34, r: radius },
      { x: width * 0.34, r: radius },
      { x: width / 2, r: radius * 0.86 },
    ];
    for (let band = 0; band < bands.length - 1; band++) {
      const a = bands[band];
      const b = bands[band + 1];
      for (let i = 0; i < count; i++) {
        const t = i * Math.PI * 2 / count;
        const next = (i + 1) * Math.PI * 2 / count;
        const host = face(id, [radial(a.x, a.r, t), radial(b.x, b.r, t), radial(b.x, b.r, next), radial(a.x, a.r, next)], RUBBER);
        if (band === 1) {
          // Alternating chevrons follow the tire circumference and steering angle.
          detail(host, [radial(a.x, a.r, t + 0.035), radial(0, radius, t + 0.075),
            radial(b.x, b.r, t + 0.035), radial(b.x, b.r, t + 0.085),
            radial(0, radius, t + 0.125), radial(a.x, a.r, t + 0.085)], "#14191c");
        }
      }
    }
    for (const side of [-1, 1]) {
      const axial = side * width / 2;
      const vertices = ring(axial, radius * 0.86);
      // The radial ring is clockwise when viewed from the positive axle end.
      if (side > 0) vertices.reverse();
      const cap = face(id, vertices, RUBBER);
      detail(cap, ring(axial, radius * 0.72), "#171d21");
      detail(cap, ring(axial, radius * 0.57), "#a1abb0");
      detail(cap, ring(axial, radius * 0.48), "#505d66");
      for (let i = 0; i < 10; i++) {
        const theta = i * Math.PI / 5;
        const bolt = Array.from({ length: 6 }, (_, j) => transform(axial,
          Math.sin(theta) * radius * 0.35 + Math.sin(j * Math.PI / 3) * 0.014,
          Math.cos(theta) * radius * 0.35 + Math.cos(j * Math.PI / 3) * 0.014));
        detail(cap, bolt, "#c3c9c7");
      }
      detail(cap, ring(axial, radius * 0.23), "#b59858");
      detail(cap, ring(axial, radius * 0.14), "#5a6266");
    }
  };
  const steering = Number.isFinite(steerAngleDeg) ? Math.max(-45, Math.min(45, steerAngleDeg)) : 0;
  tire("wheel-front-left", -0.66, 0.77, 0.26, 0.35, steering);
  tire("wheel-front-right", 0.66, 0.77, 0.26, 0.35, steering);
  tire("wheel-rear-left-outer", -0.71, -0.77, 0.22, 0.39, 0);
  tire("wheel-rear-left-inner", -0.46, -0.77, 0.21, 0.39, 0);
  tire("wheel-rear-right-outer", 0.71, -0.77, 0.22, 0.39, 0);
  tire("wheel-rear-right-inner", 0.46, -0.77, 0.21, 0.39, 0);

  box("truck-dump-body", [-0.56, -1.36, 0.59], [0.56, 0.33, 0.66], STEEL);
  for (const side of [-1, 1]) {
    const x = (value: number) => value * side;
    // Short wall sections keep the painter ordering accurate beside the rear tires.
    for (let i = 0; i < 5; i++) {
      const rear = -1.36 + i * 0.338;
      const front = rear + 0.338;
      solid("truck-dump-body", [[x(0.53), rear, 0.65], [x(0.59), rear, 0.61], [x(0.59), front, 0.61], [x(0.53), front, 0.65]],
        [[x(0.74), rear, 1.22], [x(0.8), rear, 1.24], [x(0.8), front, 1.24], [x(0.74), front, 1.22]], PAINT);
      solid("truck-bed-rib", [[x(0.59), rear, 0.62], [x(0.62), rear, 0.62], [x(0.62), rear + 0.04, 0.62], [x(0.59), rear + 0.04, 0.62]],
        [[x(0.8), rear, 1.24], [x(0.83), rear, 1.24], [x(0.83), rear + 0.04, 1.24], [x(0.8), rear + 0.04, 1.24]], EDGE);
    }
    box("truck-bed-rail", [Math.min(x(0.73), x(0.82)), -1.39, 1.22], [Math.max(x(0.73), x(0.82)), 0.38, 1.27], EDGE);
    box("truck-rear-mudguard", [Math.min(x(0.4), x(0.83)), -1.2, 0.13], [Math.max(x(0.4), x(0.83)), -1.16, 0.65], RUBBER);
    box("truck-fuel-tank", [Math.min(x(0.46), x(0.64)), -0.18, 0.29], [Math.max(x(0.46), x(0.64)), 0.28, 0.55], STEEL);
  }
  solid("truck-dump-body", [[-0.53, 0.28, 0.64], [0.53, 0.28, 0.64], [0.59, 0.36, 0.61], [-0.59, 0.36, 0.61]],
    [[-0.74, 0.28, 1.22], [0.74, 0.28, 1.22], [0.8, 0.36, 1.24], [-0.8, 0.36, 1.24]], PAINT);
  const tail = solid("truck-tailgate", [[-0.59, -1.4, 0.61], [0.59, -1.4, 0.61], [0.53, -1.34, 0.65], [-0.53, -1.34, 0.65]],
    [[-0.8, -1.4, 1.24], [0.8, -1.4, 1.24], [0.74, -1.34, 1.22], [-0.74, -1.34, 1.22]], PAINT);
  for (const x of [-0.48, 0, 0.48]) {
    frontPanel(tail.sides[0], x - 0.025, x + 0.025, -1.4, 0.7, 1.17, "#a27a36");
    box("truck-tailgate-hinge", [x - 0.055, -1.44, 0.63], [x + 0.055, -1.38, 0.72], STEEL);
  }
  box("truck-rear-bumper", [-0.66, -1.44, 0.3], [0.66, -1.35, 0.4], FRAME);
  for (const x of [-0.55, 0.43]) {
    const lamp = box("truck-rear-lamp", [x, -1.45, 0.43], [x + 0.12, -1.37, 0.49], FRAME);
    frontPanel(lamp.sides[0], x + 0.012, x + 0.065, -1.45, 0.441, 0.48, "#b44738");
    frontPanel(lamp.sides[0], x + 0.073, x + 0.108, -1.45, 0.441, 0.48, "#d5a14a");
  }

  // Forward canopy, with a rolled leading edge above the operator station.
  solid("truck-canopy", [[-0.8, 0.32, 1.24], [0.8, 0.32, 1.24], [0.72, 0.91, 1.37], [-0.72, 0.91, 1.37]],
    [[-0.8, 0.32, 1.29], [0.8, 0.32, 1.29], [0.72, 0.91, 1.42], [-0.72, 0.91, 1.42]], PAINT);
  box("truck-canopy-lip", [-0.73, 0.89, 1.37], [0.73, 0.94, 1.42], EDGE);

  box("truck-front-deck", [-0.7, 0.37, 0.52], [0.7, 1.18, 0.62], PAINT);
  const cab = solid("truck-cab-assembly", [[-0.57, 0.44, 0.62], [0.08, 0.44, 0.62], [0.08, 1.12, 0.62], [-0.57, 1.12, 0.62]],
    [[-0.55, 0.46, 1.24], [0.06, 0.46, 1.24], [0.06, 0.94, 1.24], [-0.55, 0.94, 1.24]], PAINT);
  // The glass lies on the cab's sloped sheet metal, with a visible painted surround.
  const windshieldY = (z: number) => 1.12 - (z - 0.62) * 0.18 / 0.62;
  const frontGlass = (x: number, X: number, z: number, Z: number, fill: string) =>
    detail(cab.sides[2], [[x, windshieldY(z), z], [X, windshieldY(z), z], [X, windshieldY(Z), Z], [x, windshieldY(Z), Z]], fill);
  frontGlass(-0.53, 0.035, 0.81, 1.2, "#151f25");
  frontGlass(-0.508, 0.012, 0.838, 1.176, GLASS);
  frontGlass(-0.508, 0.012, 1.11, 1.176, "#5b7b84");
  frontGlass(-0.264, -0.252, 0.83, 1.19, "#1c292f");
  detail(cab.sides[2], [[-0.46, windshieldY(0.85), 0.85], [-0.33, windshieldY(0.99), 0.99],
    [-0.32, windshieldY(0.99), 0.99], [-0.448, windshieldY(0.85), 0.85]], "#101a20");
  for (const side of [1, 3]) {
    const xAt = (z: number) => side === 3 ? -0.57 + (z - 0.62) * 0.02 / 0.62 : 0.08 - (z - 0.62) * 0.02 / 0.62;
    detail(cab.sides[side], [[xAt(0.81), 0.51, 0.81], [xAt(0.81), 1.04, 0.81],
      [xAt(1.19), 0.93, 1.19], [xAt(1.19), 0.51, 1.19]], "#19272d");
    detail(cab.sides[side], [[xAt(0.84), 0.54, 0.84], [xAt(0.84), 1.005, 0.84],
      [xAt(1.16), 0.912, 1.16], [xAt(1.16), 0.54, 1.16]], GLASS);
    detail(cab.sides[side], [[xAt(1.1), 0.54, 1.1], [xAt(1.1), 0.925, 1.1],
      [xAt(1.16), 0.912, 1.16], [xAt(1.16), 0.54, 1.16]], "#67848a");
    detail(cab.sides[side], [[xAt(0.74), 0.53, 0.74], [xAt(0.74), 0.64, 0.74],
      [xAt(0.76), 0.64, 0.76], [xAt(0.76), 0.53, 0.76]], "#26323a");
  }

  const engine = box("truck-engine-cover", [0.14, 0.42, 0.62], [0.61, 1.09, 0.89], PAINT);
  for (let i = 0; i < 7; i++) {
    const y = 0.52 + i * 0.07;
    detail(engine.top, [[0.22, y, 0.89], [0.54, y, 0.89], [0.54, y + 0.022, 0.89], [0.22, y + 0.022, 0.89]], "#564a34");
  }
  const radiator = box("truck-front-fascia", [-0.52, 1.13, 0.43], [0.52, 1.2, 0.73], FRAME);
  frontPanel(radiator.sides[2], -0.4, 0.4, 1.2, 0.48, 0.68, "#111b21");
  for (let i = 0; i < 6; i++) {
    frontPanel(radiator.sides[2], -0.38, 0.38, 1.2, 0.49 + i * 0.032, 0.5 + i * 0.032, "#68716d");
  }
  box("truck-bumper", [-0.72, 1.18, 0.29], [0.72, 1.28, 0.43], PAINT);
  for (const x of [-0.67, 0.45]) {
    const lamp = box("truck-headlamp", [x, 1.18, 0.49], [x + 0.22, 1.225, 0.6], FRAME);
    frontPanel(lamp.sides[2], x + 0.023, x + 0.093, 1.225, 0.516, 0.576, "#e2ebdd");
    frontPanel(lamp.sides[2], x + 0.113, x + 0.183, 1.225, 0.516, 0.576, "#e2ebdd");
  }
  for (const x of [-0.48, 0.4]) {
    box("truck-tow-eye", [x, 1.28, 0.31], [x + 0.08, 1.32, 0.37], STEEL);
  }

  // Access steps, handrails, mirrors and exhaust supply a readable industrial silhouette.
  for (let i = 0; i < 3; i++) {
    box("truck-access-step", [-0.73, 1.055 + i * 0.027, 0.22 + i * 0.115], [-0.52, 1.19 + i * 0.027, 0.252 + i * 0.115], STEEL);
  }
  for (const x of [-0.72, -0.52]) {
    box("truck-handrail", [x, 1.205, 0.36], [x + 0.018, 1.223, 0.91], EDGE);
  }
  box("truck-handrail", [-0.72, 1.205, 0.89], [-0.5, 1.223, 0.91], EDGE);
  box("truck-mirror-arm", [-0.72, 0.98, 1.02], [-0.54, 1, 1.04], STEEL);
  const mirror = box("truck-mirror", [-0.76, 0.96, 0.97], [-0.69, 1.01, 1.12], FRAME);
  frontPanel(mirror.sides[0], -0.75, -0.7, 0.96, 0.985, 1.1, "#8da3a7");
  box("truck-exhaust", [0.47, 0.39, 0.85], [0.53, 0.45, 1.31], STEEL);
  box("truck-exhaust-cap", [0.46, 0.38, 1.29], [0.55, 0.47, 1.33], FRAME);
  box("truck-beacon-base", [-0.48, 0.96, 1.19], [-0.38, 1.06, 1.25], FRAME);
  box("truck-beacon-lens", [-0.465, 0.975, 1.25], [-0.395, 1.045, 1.32], "#e9a52a");
  return surfaces;
}
