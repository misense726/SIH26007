import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RangeReading, SensorHealth, SpatialPoint, VehiclePose } from "../types";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { ProximityWidget, spatialPointToPlot } from "./ProximityWidget";

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

  it("shows five sensor values and preserves unknown readings", () => {
    const readings: RangeReading[] = [
      {
        timestamp_ms: 10,
        sensor_id: "front_scanner",
        angle_deg: 15,
        range_m: 1.42,
        quality: 0.94,
        max_range_m: 4,
        is_valid: true,
        mode: "LIVE",
      },
      {
        timestamp_ms: 10,
        sensor_id: "front_fixed",
        angle_deg: 0,
        range_m: 4,
        quality: 0,
        max_range_m: 4,
        is_valid: false,
        mode: "LIVE",
      },
    ];
    const sensorHealth: SensorHealth[] = [
      { sensor_id: "front_scanner", status: "HEALTHY", last_update_ms: 10, confidence: 0.94, detail: null },
      { sensor_id: "front_fixed", status: "STALE", last_update_ms: 10, confidence: 0, detail: "stale" },
      { sensor_id: "rear_scanner", status: "HEALTHY", last_update_ms: 10, confidence: 1, detail: null },
      { sensor_id: "left_side", status: "HEALTHY", last_update_ms: 10, confidence: 1, detail: null },
      { sensor_id: "right_side", status: "HEALTHY", last_update_ms: 10, confidence: 1, detail: null },
    ];

    const markup = renderToStaticMarkup(
      createElement(ProximityWidget, {
        points: [point],
        vehicle,
        validReadingCount: 1,
        readings,
        sensorHealth,
        sensorSettings: defaultSensorSettings().sensors,
        telemetryConnected: true,
      }),
    );

    expect(markup).toContain("Front scanner");
    expect(markup).toContain("1.42 m");
    expect(markup).toContain("15° scan, 94% quality");
    expect(markup).toContain("Front fixed");
    expect(markup).toContain("Unknown");
    expect(markup).toContain("STALE");
    expect(markup).toContain("Right side");
  });
});
