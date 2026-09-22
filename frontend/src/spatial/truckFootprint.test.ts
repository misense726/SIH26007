import { describe, expect, it } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { perimeterRingPoints, truckDisplayGeometry } from "./truckFootprint";

describe("truck perimeter distance", () => {
  it("places every ring point at its labelled clearance, including corners", () => {
    const { footprint } = truckDisplayGeometry(defaultSensorSettings().sensors);
    for (const distance of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
      for (const point of perimeterRingPoints(footprint, distance)) {
        const dx = Math.max(footprint.left - point.x_m, 0, point.x_m - footprint.right);
        const dy = Math.max(footprint.rear - point.y_m, 0, point.y_m - footprint.front);
        expect(Math.hypot(dx, dy)).toBeCloseTo(distance, 8);
      }
    }
  });

  it("fits within the configured mounts and keeps the haul illustration at its own scale", () => {
    const sensors = defaultSensorSettings().sensors;
    const { footprint, scale } = truckDisplayGeometry(sensors);
    expect(scale).toBeLessThan(0.5);
    expect(footprint.left).toBeGreaterThanOrEqual(-0.36);
    expect(footprint.right).toBeLessThanOrEqual(0.36);
    expect(footprint.front).toBeLessThanOrEqual(0.55);
    expect(footprint.rear).toBeGreaterThanOrEqual(-0.55);
    expect(truckDisplayGeometry(sensors, false).scale).toBe(1);
  });
});
