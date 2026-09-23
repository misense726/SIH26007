import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { defaultWorldState } from "../state/defaultState";
import { DriverDashboard } from "./DriverDashboard";

vi.mock("leaflet", () => ({ default: {} }));

describe("DriverDashboard vehicle telemetry", () => {
  it("does not present a fallback vehicle as connected data", () => {
    const markup = renderToStaticMarkup(
      <DriverDashboard
        world={{ ...defaultWorldState, vehicles: [], primary_vehicle_id: "MISSING" }}
        awarenessMode="CAMERA"
        onAwarenessModeChange={() => undefined}
        connection="CONNECTED"
        sensorSettings={defaultSensorSettings().sensors}
      />,
    );

    expect(markup).toContain("VEHICLE DATA MISSING");
    expect(markup).toContain("UNVERIFIED");
    expect(markup).not.toContain("DUMPER_01");
    expect(markup).not.toContain("Path clear");
  });

  it("raises a driver-level alert for a close healthy side ToF reading", () => {
    const reading = {
      timestamp_ms: 10,
      sensor_id: "right_side",
      angle_deg: 0,
      range_m: 0.25,
      quality: 1,
      max_range_m: 2,
      is_valid: true,
      mode: "LIVE" as const,
    };
    const world = {
      ...defaultWorldState,
      generated_at_ms: 10,
      mode: "LIVE" as const,
      vehicles: [{ ...defaultWorldState.vehicles[0], timestamp_ms: 10, mode: "LIVE" as const }],
      ranges: [reading],
      sensor_health: [{
        sensor_id: "right_side",
        status: "HEALTHY" as const,
        last_update_ms: 10,
        confidence: 1,
        detail: null,
      }],
    };

    const markup = renderToStaticMarkup(
      <DriverDashboard
        world={world}
        awarenessMode="CAMERA"
        onAwarenessModeChange={() => undefined}
        connection="CONNECTED"
        sensorSettings={defaultSensorSettings().sensors}
      />,
    );

    expect(markup).toContain("PROXIMITY ALERT");
    expect(markup).toContain("Right fixed: 0.25 m");
  });

  it("shows a nearby simulated truck and ignores transient road-edge warnings", () => {
    const ego = { ...defaultWorldState.vehicles[0], timestamp_ms: 10, position_confidence: 1 };
    const world = {
      ...defaultWorldState,
      generated_at_ms: 10,
      mode: "SIMULATED" as const,
      vehicles: [ego, { ...ego, vehicle_id: "DUMPER_02", y_m: ego.y_m + 5 }],
      emergency: { ...defaultWorldState.emergency, state: "WARNING" as const, reason: "Reduce speed." },
      ranges: [{ timestamp_ms: 10, sensor_id: "right_side" as const, angle_deg: 0,
        range_m: 0.25, quality: 1, max_range_m: 2, is_valid: true, mode: "SIMULATED" as const }],
      sensor_health: [{ sensor_id: "right_side", status: "HEALTHY" as const,
        last_update_ms: 10, confidence: 1, detail: null }],
    };
    const markup = renderToStaticMarkup(
      <DriverDashboard world={world} awarenessMode="CAMERA" onAwarenessModeChange={() => undefined}
        connection="CONNECTED" sensorSettings={defaultSensorSettings().sensors} />,
    );

    expect(markup).toContain("simulated-warning-banner");
    expect(markup).toContain("Truck ahead");
    expect(markup.split('class="driver-grid"')[0]).not.toContain("PROXIMITY ALERT");
    const withoutTruck = renderToStaticMarkup(
      <DriverDashboard world={{ ...world, vehicles: [ego] }} awarenessMode="CAMERA"
        onAwarenessModeChange={() => undefined} connection="CONNECTED"
        sensorSettings={defaultSensorSettings().sensors} />,
    );
    expect(withoutTruck).not.toContain("simulated-warning-banner");
  });
});
