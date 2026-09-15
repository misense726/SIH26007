import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { MapFeature } from "../types";
import { crusherLayout } from "./crusherLayout";
import { buildCrusherStation } from "./crusherStation";
import { createTerrainField } from "./terrainField";
import { disposeScene } from "./mineSceneGeometry";

const destination: MapFeature = { feature_id: "dump", feature_type: "DESTINATION",
  geometry_type: "POINT", label: "Crusher", points: [{ x_m: 32, y_m: 44 }],
  properties: { dock_x_m: 37, dock_y_m: 40, dock_elevation_m: 8.5 } };

describe("covered crusher receiving bay", () => {
  it("covers the whole bay and leaves the truck portal clear below the header", () => {
    const site = crusherLayout([destination]);
    const building = buildCrusherStation(site);
    building.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const x of [-1, 1, 4, 7]) for (const z of [-2.8, 0, 2.8]) {
      ray.set(new THREE.Vector3(site.x + x, site.elevation + 10, -site.y + z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(building, true);
      expect(hits.some((h) => h.object.name === "continuous-pitched-roof" || h.object.name === "ridge-cap")).toBe(true);
    }
    for (const z of [-1, 0, 1]) {
      ray.set(new THREE.Vector3(site.x - 5, site.elevation + 2, -site.y + z), new THREE.Vector3(1, 0, 0));
      expect(ray.intersectObject(building, true)[0].point.x).toBeGreaterThan(site.x + 6);
    }
    disposeScene(building);
  });
  it("keeps the wheel footprint on the apron and opens the pocket beyond the tail", () => {
    const site = crusherLayout([destination]);
    const field = createTerrainField([destination]);
    for (const axle of [-0.77, 0.77]) for (const wheel of [-0.8, 0.8])
      expect(field(site.x + axle, site.y + wheel).elevation).toBe(site.elevation);
    expect(field(site.pocketX, site.pocketY).elevation).toBeCloseTo(site.elevation - 3.6);
    expect(site.inPocket(site.x + 1.7, site.y)).toBe(true);
    expect(site.inPocket(32, 44)).toBe(false);
  });
});
