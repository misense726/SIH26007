import { describe, expect, it } from "vitest";
import type { SpatialPoint, VehiclePose } from "../types";
import { spatialPointToPlot } from "./ProximityWidget";

const vehicle: VehiclePose = {
  timestamp_ms: 1,
  vehicle_id: "DUMPER_01",
  x_m: 0,
  y_m: 0,
  heading_deg: 0,
  speed_mps: 0,
  position_confidence: 1,
  mode: "SIMULATED",
};

const point: SpatialPoint = {
  timestamp_ms: 1,
  source_sensor_id: "front_scanner",
  x_m: 0,
  y_m: 2,
  height_hint_m: 0.8,
  quality: 1,
};

describe("proximity point projection", () => {
  it("places a forward mapped return above the vehicle", () => {
    const projected = spatialPointToPlot(point, vehicle);
    expect(projected.x).toBeCloseTo(120);
    expect(projected.y).toBeCloseTo(76);
  });

  it("places a right-side mapped return to the right", () => {
    const projected = spatialPointToPlot(
      { ...point, source_sensor_id: "right_side", x_m: 1, y_m: 0 },
      vehicle,
    );
    expect(projected.x).toBeCloseTo(142);
    expect(projected.y).toBeCloseTo(120);
  });
});
