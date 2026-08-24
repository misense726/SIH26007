import { describe, expect, it } from "vitest";
import { defaultWorldState } from "./defaultState";
import { nearestRange, primaryVehicle } from "./selectors";

describe("world selectors", () => {
  it("selects the backend-designated primary vehicle", () => {
    const world = {
      ...defaultWorldState,
      primary_vehicle_id: "DUMPER_02",
      vehicles: [
        defaultWorldState.vehicles[0],
        { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_02", x_m: 4 },
      ],
    };
    expect(primaryVehicle(world).x_m).toBe(4);
  });

  it("ignores low-quality and zero ranges", () => {
    const base = {
      timestamp_ms: 1,
      angle_deg: 0,
      mode: "SIMULATED" as const,
    };
    expect(
      nearestRange([
        { ...base, sensor_id: "bad", range_m: 0.1, quality: 0.2 },
        { ...base, sensor_id: "zero", range_m: 0, quality: 1 },
        { ...base, sensor_id: "good", range_m: 1.4, quality: 0.9 },
      ]),
    ).toBe(1.4);
  });
});

