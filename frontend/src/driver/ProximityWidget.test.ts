import { describe, expect, it } from "vitest";
import { proximityPoint } from "./ProximityWidget";

describe("proximity point projection", () => {
  it("places a forward range above the vehicle", () => {
    const point = proximityPoint({
      timestamp_ms: 1,
      sensor_id: "front_scanner",
      angle_deg: 0,
      range_m: 2,
      quality: 1,
      max_range_m: 4,
      is_valid: true,
      mode: "SIMULATED",
    });
    expect(point.x).toBeCloseTo(120);
    expect(point.y).toBeCloseTo(76);
  });

  it("places a right-side range to the right", () => {
    const point = proximityPoint({
      timestamp_ms: 1,
      sensor_id: "right_side",
      angle_deg: 0,
      range_m: 1,
      quality: 1,
      max_range_m: 4,
      is_valid: true,
      mode: "SIMULATED",
    });
    expect(point.x).toBeCloseTo(142);
    expect(point.y).toBeCloseTo(120);
  });
});
