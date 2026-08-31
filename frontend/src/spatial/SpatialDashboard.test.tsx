import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { defaultWorldState } from "../state/defaultState";
import { SpatialDashboard } from "./SpatialDashboard";

describe("SpatialDashboard scanner motion and proximity", () => {
  it("does not fabricate a truck when the primary vehicle is missing", () => {
    const markup = renderToStaticMarkup(
      <SpatialDashboard
        world={{ ...defaultWorldState, vehicles: [], primary_vehicle_id: "MISSING" }}
        connection="CONNECTED"
        sensorSettings={defaultSensorSettings().sensors}
      />,
    );

    expect(markup).toContain("Vehicle data unavailable");
    expect(markup).not.toContain("vehicle-3d-truck");
    expect(markup).not.toContain("DUMPER_01 3D model");
  });

  it("keeps the latest scanner angle when that range sample is invalid", () => {
    const sensorSettings = defaultSensorSettings().sensors;
    const world = {
      ...defaultWorldState,
      generated_at_ms: 1_000,
      mode: "LIVE" as const,
      ranges: [
        {
          timestamp_ms: 1_000,
          sensor_id: "front_scanner" as const,
          angle_deg: 50,
          range_m: 0,
          quality: 0,
          max_range_m: 4,
          is_valid: false,
          mode: "LIVE" as const,
        },
      ],
      sensor_health: [
        {
          sensor_id: "front_scanner",
          status: "HEALTHY" as const,
          last_update_ms: 1_000,
          confidence: 1,
          detail: null,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <SpatialDashboard
        world={world}
        connection="CONNECTED"
        sensorSettings={sensorSettings}
      />,
    );

    expect(markup).toContain("Front scanner head 50°");
    expect(markup).toContain("Coverage incomplete · 0/5 valid");
    expect(markup).toContain("fov-unknown-gradient");
    expect(markup).not.toMatch(/Clear\s*·/);
    expect(markup).toContain("Spatial view");
    expect(markup).not.toContain("MPU-6050 dynamic 3D truck movement");
    expect(markup).not.toContain("MPU-6050 + 5×ToF");
    expect(markup).not.toContain("3D PERSPECTIVE TOF DEPTH VIEW");
    expect(markup).toContain("vertically to change the viewing angle");
    expect(markup).toContain("vehicle-3d-truck");
  });

  it("renders red alert banner, danger FOV cones, and floating obstacle pill on proximity alert", () => {
    const sensorSettings = defaultSensorSettings().sensors;
    const world = {
      ...defaultWorldState,
      generated_at_ms: 1_000,
      mode: "LIVE" as const,
      ranges: [
        {
          timestamp_ms: 1_000,
          sensor_id: "front_scanner" as const,
          angle_deg: 0,
          range_m: 0.35,
          quality: 0.98,
          max_range_m: 4,
          is_valid: true,
          mode: "LIVE" as const,
        },
      ],
      spatial_points: [
        {
          timestamp_ms: 1_000,
          source_sensor_id: "front_scanner" as const,
          x_m: 0,
          y_m: 0.85,
          height_hint_m: 0.3,
          quality: 1,
        },
      ],
      sensor_health: [
        {
          sensor_id: "front_scanner",
          status: "HEALTHY" as const,
          last_update_ms: 1_000,
          confidence: 1,
          detail: null,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <SpatialDashboard
        world={world}
        connection="CONNECTED"
        sensorSettings={sensorSettings}
      />,
    );

    // Hazard Alert Banner
    expect(markup).toContain("PROXIMITY HAZARD");
    expect(markup).toContain("0.35 m");
    // Danger Sector / FOV
    expect(markup).toContain("fov-alert-active");
    expect(markup).toContain("beam-alert");
    // Floating Obstacle Pill
    expect(markup).toContain("spatial-obstacle-pill");
    expect(markup).toContain("pill-alert");
    expect(markup).toContain("0.35m");
    // 3D Distance Rings
    expect(markup).toContain("range-distance-ring");
    expect(markup).toContain(">1/5 valid<");
    expect(markup).not.toMatch(/Clear\s*·/);
  });
});
