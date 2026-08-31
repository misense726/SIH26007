import { describe, expect, it } from "vitest";
import { defaultWorldState } from "./defaultState";
import { availableRangeReadings } from "./rangeReadings";
import {
  nearestRange,
  primaryVehicle,
  primaryVehicleOrNull,
  tofSensorHealth,
  tofSensorHealthSummary,
} from "./selectors";

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
    expect(primaryVehicleOrNull(world)?.vehicle_id).toBe("DUMPER_02");
  });

  it("does not fabricate a primary vehicle when telemetry has none", () => {
    const world = { ...defaultWorldState, vehicles: [] };

    expect(primaryVehicleOrNull(world)).toBeNull();
  });

  it("does not promote a different vehicle when the designated primary is absent", () => {
    const world = {
      ...defaultWorldState,
      primary_vehicle_id: "MISSING_PRIMARY",
      vehicles: [{ ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_02" }],
    };

    expect(primaryVehicleOrNull(world)).toBeNull();
  });

  it("ignores invalid, non-finite, low-quality, and zero ranges", () => {
    const base = {
      timestamp_ms: 1,
      angle_deg: 0,
      max_range_m: 4,
      is_valid: true,
      mode: "SIMULATED" as const,
    };
    expect(
      nearestRange([
        { ...base, sensor_id: "invalid", range_m: 0.05, quality: 1, is_valid: false },
        { ...base, sensor_id: "nan", range_m: Number.NaN, quality: 1 },
        { ...base, sensor_id: "bad", range_m: 0.1, quality: 0.2 },
        { ...base, sensor_id: "zero", range_m: 0, quality: 1 },
        { ...base, sensor_id: "good", range_m: 1.4, quality: 0.9 },
      ]),
    ).toBe(1.4);
  });

  it("does not expose a stale range to dashboard summaries", () => {
    const reading = {
      timestamp_ms: 1,
      sensor_id: "front_fixed",
      angle_deg: 0,
      range_m: 0.2,
      quality: 1,
      max_range_m: 2,
      is_valid: true,
      mode: "LIVE" as const,
    };
    const health = {
      sensor_id: "front_fixed",
      status: "STALE" as const,
      last_update_ms: 1,
      confidence: 0,
      detail: "No fresh MAIN packet",
    };

    expect(availableRangeReadings([reading], [health], true)).toEqual([]);
  });

  it("summarizes the final five-ToF health layout", () => {
    const sensors = [
      "front_scanner",
      "front_fixed",
      "rear_scanner",
      "left_side",
      "right_side",
    ].map((sensorId) => ({
      sensor_id: sensorId,
      status: "HEALTHY" as const,
      last_update_ms: 1,
      confidence: 1,
      detail: null,
    }));

    const mixedHealth = [
      ...sensors,
      { ...sensors[0], sensor_id: "mpu6050" },
      { ...sensors[0], sensor_id: "bmp280", status: "OFFLINE" as const },
    ];

    expect(tofSensorHealth(mixedHealth).map((sensor) => sensor.sensor_id)).toEqual([
      "front_scanner",
      "front_fixed",
      "rear_scanner",
      "left_side",
      "right_side",
    ]);
    expect(tofSensorHealthSummary(mixedHealth)).toEqual({ healthy: 5, total: 5 });
    expect(tofSensorHealthSummary([{ ...sensors[0], status: "OFFLINE" }])).toEqual({
      healthy: 0,
      total: 5,
    });
    expect(tofSensorHealthSummary(mixedHealth.slice(5))).toEqual({ healthy: 0, total: 5 });
    expect(tofSensorHealth([{ ...sensors[0], status: "OFFLINE" }])).toEqual([
      { ...sensors[0], status: "OFFLINE" },
      expect.objectContaining({ sensor_id: "front_fixed", status: "OFFLINE", confidence: 0 }),
      expect.objectContaining({ sensor_id: "rear_scanner", status: "OFFLINE", confidence: 0 }),
      expect.objectContaining({ sensor_id: "left_side", status: "OFFLINE", confidence: 0 }),
      expect.objectContaining({ sensor_id: "right_side", status: "OFFLINE", confidence: 0 }),
    ]);
  });
});
