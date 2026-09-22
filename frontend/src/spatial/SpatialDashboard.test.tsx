import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { defaultWorldState } from "../state/defaultState";
import type { WorldState } from "../types";
import { SpatialDashboard } from "./SpatialDashboard";

const sensors = defaultSensorSettings().sensors;
const render = (world: WorldState, connected = true) => renderToStaticMarkup(
  <SpatialDashboard world={world} connection={connected ? "CONNECTED" : "DISCONNECTED"} sensorSettings={sensors} />);

describe("Spatial point-cloud dashboard", () => {
  it.each(["LIVE", "SIMULATED", "REPLAY"] as const)("shows only the mapping view in %s", mode => {
    const markup = render({ ...defaultWorldState, mode });
    expect(markup).toContain('class="point-cloud-canvas"');
    expect(markup).toContain(`>${mode}</span>`);
    for (const control of ["Orbit view", "Plan view", "Distance grid", "Coverage", "View controls", "Fit returns", "Reset view"]) {
      expect(markup).not.toContain(control);
    }
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("sensor-beam");
    expect(markup).not.toContain("range-distance-ring");
  });

  it("reports a missing vehicle instead of claiming live measurements", () => {
    const markup = render({ ...defaultWorldState, mode: "LIVE", vehicles: [], primary_vehicle_id: "MISSING" });
    expect(markup).toContain("Vehicle data unavailable");
    expect(markup).toContain("0 measured returns");
    expect(markup).not.toContain("Telemetry connected");
  });

  it("retains a latched emergency even without spatial returns", () => {
    const markup = render({ ...defaultWorldState, mode: "LIVE", emergency: {
      ...defaultWorldState.emergency, state: "EMERGENCY_STOP", reason: "Stop remains active", motor_cut: true,
    } });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Automatic Emergency Stop Simulation");
    expect(markup).toContain("Stop remains active");
    expect(markup).not.toContain("No proximity hazards");
  });

  it("shows measured proximity warnings independently of the cloud", () => {
    const world: WorldState = { ...defaultWorldState, generated_at_ms: 1000, mode: "LIVE",
      ranges: [{ timestamp_ms: 1000, sensor_id: "front_scanner", range_m: 0.35, angle_deg: 0,
        is_valid: true, quality: 1, max_range_m: 4, mode: "LIVE" }],
      sensor_health: [{ sensor_id: "front_scanner", status: "HEALTHY", last_update_ms: 1000, confidence: 1, detail: null }],
    };
    expect(render(world)).toContain("Proximity hazard: Front scanner");
    expect(render(world)).toContain("0.35 m from sensor");
    expect(render({ ...world, generated_at_ms: 5000 })).not.toContain("Proximity hazard");
    expect(render(world, false)).not.toContain("Proximity hazard");
  });

  it("keeps simulated backend warnings visible", () => {
    const markup = render({ ...defaultWorldState, emergency: {
      ...defaultWorldState.emergency, state: "WARNING", reason: "Forward obstacle is inside the warning distance",
    } });
    expect(markup).toContain("simulated-spatial-warning");
    expect(markup).toContain("Warning active");
    expect(markup).toContain("Forward obstacle is inside the warning distance");
  });
});
