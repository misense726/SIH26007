import { describe, expect, it } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { defaultWorldState } from "./defaultState";
import { availableSpatialPoints, spatialPointCellKey } from "./spatialPoints";

const sensors = defaultSensorSettings().sensors;
const vehicle = defaultWorldState.vehicles[0];
const point = {
  timestamp_ms: 1_000, source_sensor_id: "front_scanner", x_m: 0,
  y_m: 4.3, height_hint_m: 0.8, quality: 1,
};
const health = {
  sensor_id: "front_scanner", status: "HEALTHY" as const,
  last_update_ms: 1_000, confidence: 1, detail: null,
};

describe("sensor-relative point visibility", () => {
  it("retains marker identity as a cell receives new samples, avoiding repeated entrance flashes", () => {
    expect(spatialPointCellKey({ ...point, x_m: 1, timestamp_ms: 1200 }))
      .toEqual(spatialPointCellKey({ ...point, x_m: 1.001, timestamp_ms: 1100 }));
    expect(spatialPointCellKey({ ...point, x_m: 1.08 }))
      .not.toEqual(spatialPointCellKey({ ...point, x_m: 1 }));
  });
  it("keeps a scanner sweep when fixed sensors repeat hundreds of measurements", () => {
    const scan = Array.from({ length: 70 }, (_, i) => ({ ...point, x_m: -1.4 + i * 0.04, y_m: 1.5 }));
    const repeats = Array.from({ length: 600 }, (_, i) => ({ ...point,
      source_sensor_id: "left_side", x_m: -1, y_m: 0, timestamp_ms: 1000 + i }));
    const selected = availableSpatialPoints([...scan, ...repeats],
      [health, { ...health, sensor_id: "left_side" }], true, 1600, vehicle, undefined, sensors);
    expect(selected.filter((p) => p.source_sensor_id === "front_scanner")).toHaveLength(70);
    expect(selected.filter((p) => p.source_sensor_id === "left_side")).toEqual([repeats.at(-1)]);
  });

  it("keeps the latest timestamp in a cell even if observations arrive out of order", () => {
    const newer = { ...point, timestamp_ms: 1100, quality: 0.9 };
    expect(availableSpatialPoints([newer, point], [health], true, 1100, vehicle, undefined, sensors))
      .toEqual([newer]);
  });

  it("reserves room for each sensor when one source exceeds the display budget", () => {
    const dense = Array.from({ length: 400 }, (_, i) => ({ ...point,
      x_m: -1 + (i % 20) * 0.08, y_m: 1 + Math.floor(i / 20) * 0.08 }));
    const rear = { ...point, source_sensor_id: "rear_scanner", x_m: 0, y_m: -1 };
    const selected = availableSpatialPoints([rear, ...dense],
      [health, { ...health, sensor_id: "rear_scanner" }], true, 1000, vehicle, undefined, sensors);
    expect(selected).toHaveLength(240);
    expect(selected).toContainEqual(rear);
  });

  it("includes the sensor mount offset without extending its sensing range", () => {
    const points = [point, { ...point, y_m: 4.33 }];
    expect(availableSpatialPoints(points, [health], true, 1_000, vehicle, undefined, sensors))
      .toEqual([point]);
  });

  it("continues rejecting stale, invalid, unknown-source and disconnected returns", () => {
    const points = [point, { ...point, timestamp_ms: -12_000 },
      { ...point, quality: 0.49 }, { ...point, x_m: NaN },
      { ...point, source_sensor_id: "unknown" }, { ...point, timestamp_ms: 1_001 }];
    expect(availableSpatialPoints(points, [health], true, 1_000, vehicle, undefined, sensors))
      .toEqual([point]);
    expect(availableSpatialPoints([point], [health], false, 1_000, vehicle, undefined, sensors))
      .toEqual([]);
    for (const status of ["STALE", "OFFLINE"] as const) {
      expect(availableSpatialPoints([point], [{ ...health, status }], true, 1_000, vehicle, undefined, sensors))
        .toEqual([]);
    }
  });
});
