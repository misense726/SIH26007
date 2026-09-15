import * as THREE from "three";
import { buildTruckMesh } from "../spatial/truckMesh";
import { grain } from "./terrainField";
export { buildTerrain, buildVegetation, textureGrain } from "./mineLandscape";

export const DUMP_BED_PARTS = new Set([
  "truck-dump-body",
  "truck-bed-rib",
  "truck-bed-rail",
  "truck-tailgate",
  "truck-tailgate-hinge",
  "truck-canopy",
  "truck-canopy-lip",
]);

export const TRUCK_HINGE_Y = 0.675;
export const TRUCK_HINGE_Z = 1.41;
export const FRONT_WHEEL_Y = 0.35;
export const FRONT_WHEEL_Z = -0.77;
export const FRONT_WHEEL_TRACK = 0.66;

export function truckGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [],
    color = new THREE.Color();
  for (const face of buildTruckMesh(0)) {
    if (DUMP_BED_PARTS.has(face.part) || face.part === "truck-ore-cargo") continue;
    if (face.part === "wheel-front-left" || face.part === "wheel-front-right")
      continue;
    for (const surface of [face, ...face.details]) {
      color.set(surface.fill);
      for (let i = 1; i < surface.points.length - 1; i++)
        for (const p of [
          surface.points[0],
          surface.points[i],
          surface.points[i + 1],
        ]) {
          positions.push(p.x_m, p.z_m, -p.y_m);
          colors.push(color.r, color.g, color.b);
        }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function dumpBedGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [],
    color = new THREE.Color();
  for (const face of buildTruckMesh(0)) {
    if (!DUMP_BED_PARTS.has(face.part)) continue;
    for (const surface of [face, ...face.details]) {
      color.set(surface.fill);
      for (let i = 1; i < surface.points.length - 1; i++)
        for (const p of [
          surface.points[0],
          surface.points[i],
          surface.points[i + 1],
        ]) {
          positions.push(p.x_m, p.z_m - TRUCK_HINGE_Y, -p.y_m - TRUCK_HINGE_Z);
          colors.push(color.r, color.g, color.b);
        }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function frontWheelGeometry(isLeft: boolean): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [],
    color = new THREE.Color();
  const targetPart = isLeft ? "wheel-front-left" : "wheel-front-right";
  const pivotX = isLeft ? -FRONT_WHEEL_TRACK : FRONT_WHEEL_TRACK;
  for (const face of buildTruckMesh(0)) {
    if (face.part !== targetPart) continue;
    for (const surface of [face, ...face.details]) {
      color.set(surface.fill);
      for (let i = 1; i < surface.points.length - 1; i++)
        for (const p of [
          surface.points[0],
          surface.points[i],
          surface.points[i + 1],
        ]) {
          positions.push(
            p.x_m - pivotX,
            p.z_m - FRONT_WHEEL_Y,
            -p.y_m - FRONT_WHEEL_Z,
          );
          colors.push(color.r, color.g, color.b);
        }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Rich 3D iron ore payload model inside the dump bed tub.
 */
export function oreCargoGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [],
    color = new THREE.Color();
  const oreColors = ["#62241a", "#4a1911", "#782e21", "#873527", "#3d130c"];

  // Faceted 3D ore mound spanning the dump bed interior (relative to hinge)
  const xLeft = -0.48,
    xRight = 0.48,
    zFront = -1.72,
    zRear = -0.08,
    yFloor = 0.05,
    yHeaped = 0.46;

  const quad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    colHex: string,
  ) => {
    color.set(colHex);
    positions.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b);
  };

  const tri = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    colHex: string,
  ) => {
    color.set(colHex);
    positions.push(...p0, ...p1, ...p2);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  };

  // Slices along Z axis
  const zSlices = 8;
  for (let s = 0; s < zSlices - 1; s++) {
    const t0 = s / (zSlices - 1);
    const t1 = (s + 1) / (zSlices - 1);
    const z0 = zFront + t0 * (zRear - zFront);
    const z1 = zFront + t1 * (zRear - zFront);

    // Natural mound ridge profile
    const h0 = yFloor + Math.sin(t0 * Math.PI) * (yHeaped - yFloor) * 0.95 + grain(s, 7) * 0.05;
    const h1 = yFloor + Math.sin(t1 * Math.PI) * (yHeaped - yFloor) * 0.95 + grain(s + 1, 7) * 0.05;

    const cA = oreColors[(s * 2) % oreColors.length];
    const cB = oreColors[(s * 2 + 1) % oreColors.length];
    const cC = oreColors[(s * 2 + 2) % oreColors.length];

    // Left slope
    quad(
      [xLeft, yFloor, z0],
      [-0.16, h0, z0],
      [-0.16, h1, z1],
      [xLeft, yFloor, z1],
      cA,
    );
    // Center ridge
    quad(
      [-0.16, h0, z0],
      [0.16, h0, z0],
      [0.16, h1, z1],
      [-0.16, h1, z1],
      cB,
    );
    // Right slope
    quad(
      [0.16, h0, z0],
      [xRight, yFloor, z0],
      [xRight, yFloor, z1],
      [0.16, h1, z1],
      cC,
    );
  }

  // Front cap
  const hF = yFloor + Math.sin(0) * (yHeaped - yFloor);
  tri([xLeft, yFloor, zFront], [0, hF + 0.1, zFront], [xRight, yFloor, zFront], "#4a1911");

  // Rear cap
  const hR = yFloor + Math.sin(Math.PI) * (yHeaped - yFloor);
  tri([xRight, yFloor, zRear], [0, hR + 0.1, zRear], [xLeft, yFloor, zRear], "#3d130c");

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Volumetric cascading 3D iron ore stream that pours from the tailgate into the crusher hopper.
 */
export function oreChuteGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [],
    color = new THREE.Color();
  const oreTones = ["#542016", "#45170f", "#66261b", "#3d130c", "#702b1f"];

  // 10 cross-sections along the curved trajectory down into the hopper
  const segments = 10;
  for (let i = 0; i < segments - 1; i++) {
    const t0 = i / (segments - 1);
    const t1 = (i + 1) / (segments - 1);

    // Gravity curve profile
    const y0 = -0.05 - t0 * t0 * 2.2;
    const z0 = t0 * 1.6;
    const w0 = 0.52 + t0 * 0.45; // expands as it pours
    const th0 = 0.28 * (1 - t0 * 0.35);

    const y1 = -0.05 - t1 * t1 * 2.2;
    const z1 = t1 * 1.6;
    const w1 = 0.52 + t1 * 0.45;
    const th1 = 0.28 * (1 - t1 * 0.35);

    const quad = (
      p0: [number, number, number],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
      hex: string,
    ) => {
      color.set(hex);
      positions.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
      for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b);
    };

    const c = oreTones[i % oreTones.length];
    const cSide = oreTones[(i + 1) % oreTones.length];

    // Top cascading surface
    quad(
      [-w0, y0, z0],
      [w0, y0, z0],
      [w1, y1, z1],
      [-w1, y1, z1],
      c,
    );
    // Underside
    quad(
      [-w0, y0 - th0, z0],
      [-w1, y1 - th1, z1],
      [w1, y1 - th1, z1],
      [w0, y0 - th0, z0],
      cSide,
    );
    // Left edge
    quad(
      [-w0, y0, z0],
      [-w1, y1, z1],
      [-w1, y1 - th1, z1],
      [-w0, y0 - th0, z0],
      cSide,
    );
    // Right edge
    quad(
      [w0, y0, z0],
      [w0, y0 - th0, z0],
      [w1, y1 - th1, z1],
      [w1, y1, z1],
      cSide,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 3D faceted iron ore rock boulder with randomized jagged facets.
 */
export function oreRockGeometry(seed: number = 0): THREE.BufferGeometry {
  const radius = 0.18 + (grain(seed, 11) * 0.16);
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const factor = 0.78 + 0.38 * grain(Math.round(x * 80 + seed * 13), Math.round(z * 80));
    pos.setXYZ(i, x * factor, y * (0.8 + 0.3 * factor), z * factor);
  }
  geo.computeVertexNormals();
  return geo;
}

export function disposeScene(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        if (object instanceof THREE.InstancedMesh) object.dispose();
      }
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
