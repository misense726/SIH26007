import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { MapFeature } from "../types";
import { createTerrainField, insidePolygon } from "./terrainField";
import { disposeScene, truckGeometry } from "./mineSceneGeometry";

const square = (r: number) => [
  { x_m: -r, y_m: -r },
  { x_m: r, y_m: -r },
  { x_m: r, y_m: r },
  { x_m: -r, y_m: r },
];
const features: MapFeature[] = [
  {
    feature_id: "road",
    feature_type: "ROAD",
    geometry_type: "POLYGON",
    points: square(10),
    label: "Road",
    properties: {},
  },
  {
    feature_id: "pit",
    feature_type: "HAZARD_ZONE",
    geometry_type: "POLYGON",
    points: square(5),
    label: "Pit",
    properties: { cartography: "pit" },
  },
  {
    feature_id: "bench",
    feature_type: "TERRAIN",
    geometry_type: "POLYGON",
    points: square(3),
    label: "Bench",
    properties: { cartography: "bench" },
  },
];

describe("modeled mine terrain", () => {
  it("keeps the backend road outside the pit and lowers modeled benches", () => {
    const field = createTerrainField(features);
    expect(insidePolygon(0, 0, square(5))).toBe(true);
    expect(insidePolygon(8, 0, square(5))).toBe(false);
    expect(field(8, 0).road).toBe(true);
    expect(field(0, 0).road).toBe(false);
    expect(field(0, 0).level).toBe(1);
    expect(field(0, 0).elevation).toBeLessThan(field(4, 0).elevation);
    expect(field(4, 0).elevation).toBeLessThan(field(8, 0).elevation);
  });
  it("produces deterministic finite heights without changing backend features", () => {
    const original = JSON.stringify(features),
      field = createTerrainField(features);
    for (let x = -70; x < 85; x += 3)
      for (let y = -50; y < 105; y += 3) {
        expect(Number.isFinite(field(x, y).elevation)).toBe(true);
        expect(field(x, y)).toEqual(field(x, y));
      }
    expect(JSON.stringify(features)).toBe(original);
  });
  it("reuses the detailed truck mesh with finite WebGL coordinates", () => {
    const geometry = truckGeometry(),
      points = geometry.getAttribute("position");
    expect(points.count).toBeGreaterThan(1000);
    expect(Array.from(points.array).every(Number.isFinite)).toBe(true);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeGreaterThan(-0.1);
    expect(geometry.boundingBox!.max.y).toBeGreaterThan(1);
    geometry.dispose();
  });
  it("disposes shared geometry, material and textures exactly once", () => {
    const geometry = new THREE.BoxGeometry(),
      texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        normalMap: texture,
      }),
      scene = new THREE.Scene();
    let geometryCount = 0,
      materialCount = 0,
      textureCount = 0;
    geometry.addEventListener("dispose", () => geometryCount++);
    material.addEventListener("dispose", () => materialCount++);
    texture.addEventListener("dispose", () => textureCount++);
    scene.add(
      new THREE.Mesh(geometry, material),
      new THREE.Mesh(geometry, material),
    );
    disposeScene(scene);
    expect([geometryCount, materialCount, textureCount]).toEqual([1, 1, 1]);
  });
});
