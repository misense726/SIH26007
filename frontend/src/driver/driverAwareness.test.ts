import { describe, expect, it } from "vitest";
import type { RangeReading, SpatialPoint, VehiclePose } from "../types";
import { availableRangeReadings } from "../state/rangeReadings";
import { availableSpatialPoints } from "../state/spatialPoints";
import {
  DEFAULT_AWARENESS_MODE,
  isUsableRangeReading,
  spatialPointToPlot,
} from "./driverAwareness";

const reading: RangeReading = {
  timestamp_ms: 1,
  sensor_id: "front_scanner",
  angle_deg: 0,
  range_m: 2,
  quality: 1,
  max_range_m: 4,
  is_valid: true,
  mode: "SIMULATED",
};

const vehicle: VehiclePose = {
  timestamp_ms: 100,
  vehicle_id: "DUMPER_01",
  x_m: 10,
  y_m: 20,
  heading_deg: 0,
  speed_mps: 0,
  position_confidence: 1,
  mode: "SIMULATED",
};

const spatialPoint: SpatialPoint = {
  x_m: 10,
  y_m: 22,
  height_hint_m: 0.8,
  source_sensor_id: "front_scanner",
  quality: 1,
  timestamp_ms: 100,
};

describe("driver awareness mode", () => {
  it("defaults to the camera display", () => {
    expect(DEFAULT_AWARENESS_MODE).toBe("CAMERA");
  });
});

describe("ToF range filtering", () => {
  it("keeps only valid, trustworthy positive ranges", () => {
    expect(isUsableRangeReading(reading)).toBe(true);
    expect(isUsableRangeReading({ ...reading, is_valid: false })).toBe(false);
    expect(isUsableRangeReading({ ...reading, quality: 0.49 })).toBe(false);
    expect(isUsableRangeReading({ ...reading, range_m: 0 })).toBe(false);
    expect(isUsableRangeReading({ ...reading, range_m: Number.NaN })).toBe(false);
  });

  it("removes disconnected, stale, and offline sensor readings", () => {
    const health = {
      sensor_id: reading.sensor_id,
      status: "HEALTHY" as const,
      last_update_ms: 1,
      confidence: 1,
      detail: null,
    };

    expect(availableRangeReadings([reading], [health], true)).toHaveLength(1);
    expect(availableRangeReadings([reading], [health], false)).toEqual([]);
    expect(
      availableRangeReadings([reading], [{ ...health, status: "STALE" }], true),
    ).toEqual([]);
    expect(
      availableRangeReadings([reading], [{ ...health, status: "OFFLINE" }], true),
    ).toEqual([]);
  });

  it("removes unavailable and expired mapped returns", () => {
    const health = {
      sensor_id: spatialPoint.source_sensor_id,
      status: "HEALTHY" as const,
      last_update_ms: 100,
      confidence: 1,
      detail: null,
    };

    expect(availableSpatialPoints([spatialPoint], [health], true, 100, vehicle)).toHaveLength(1);
    expect(availableSpatialPoints([spatialPoint], [health], false, 100, vehicle)).toEqual([]);
    expect(
      availableSpatialPoints(
        [spatialPoint],
        [{ ...health, status: "OFFLINE" }],
        true,
        100,
        vehicle,
      ),
    ).toEqual([]);
    expect(availableSpatialPoints([spatialPoint], [health], true, 12_101, vehicle)).toEqual([]);
    expect(
      availableSpatialPoints([{ ...spatialPoint, y_m: 25 }], [health], true, 100, vehicle),
    ).toEqual([]);
  });
});

describe("backend-mapped ToF projection", () => {
  it("projects world points around the vehicle", () => {
    const front = spatialPointToPlot(spatialPoint, vehicle);
    expect(front.x).toBeCloseTo(120);
    expect(front.y).toBeCloseTo(76);

    const rear = spatialPointToPlot({ ...spatialPoint, y_m: 18 }, vehicle);
    expect(rear.x).toBeCloseTo(120);
    expect(rear.y).toBeCloseTo(164);

    const right = spatialPointToPlot({ ...spatialPoint, x_m: 11, y_m: 20 }, vehicle);
    expect(right.x).toBeCloseTo(142);
    expect(right.y).toBeCloseTo(120);
  });

  it("accounts for vehicle heading and keeps metric distance", () => {
    const turned = spatialPointToPlot(spatialPoint, { ...vehicle, heading_deg: 90 });
    expect(turned.x).toBeCloseTo(76);
    expect(turned.y).toBeCloseTo(120);

    const distant = spatialPointToPlot({ ...spatialPoint, y_m: 28 }, vehicle);
    expect(distant.y).toBeCloseTo(-56);
    expect(distant.distance_m).toBeCloseTo(8);
  });
});
