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

  it("ignores a simulated berm-range warning without a rock or truck ahead", () => {
    const markup = render({ ...defaultWorldState, emergency: {
      ...defaultWorldState.emergency, state: "WARNING", reason: "Forward obstacle is inside the warning distance",
    } });
    expect(markup).not.toContain("simulated-spatial-warning");
    expect(markup).not.toContain('role="alert"');
  });

  it("warns only for a simulated truck or rock in front", () => {
    const ego = { ...defaultWorldState.vehicles[0], position_confidence: 1 };
    const peer = { ...ego, vehicle_id: "DUMPER_02", y_m: 5 };
    const world = { ...defaultWorldState, vehicles: [ego, peer] };
    expect(render(world)).toContain("Truck ahead");
    expect(render({ ...world, vehicles: [ego, { ...peer, y_m: -5 }] })).not.toContain("Truck ahead");
    const haul_route = { origin: "Pit", destination: "Crusher", phase: "OBSTACLE" as const,
      distance_m: 0, total_distance_m: 100, remaining_m: 100, elapsed_s: 0,
      obstacle: { x_m: 0, y_m: 5 }, obstacle_radius_m: 0.5,
      obstacle_detected: true, next_instruction: "Detour" };
    expect(render({ ...world, vehicles: [ego], haul_route })).toContain("Rock ahead");
  });

  it("shows motion and road elevation in the simulated view", () => {
    const vehicle = { ...defaultWorldState.vehicles[0], speed_mps: 2.8, position_confidence: 1,
      haul: { phase: "HAULING", payload_fraction: 0.8, phase_progress: 0.4, cycle: 1,
        bed_angle_deg: 0, road_elevation_m: -12.5, road_pitch_deg: 3.2 } };
    const world: WorldState = { ...defaultWorldState, vehicles: [vehicle], reference_map: {
      map_id: "grade-test", name: "Grade", version: 1, created_at_ms: 0,
      coordinate_frame: "LOCAL_CARTESIAN_METRES", source: "test", features: [{
        feature_id: "grade", feature_type: "ROAD", geometry_type: "POLYLINE", label: "Grade",
        points: [{ x_m: 0, y_m: 0 }, { x_m: 0, y_m: 30 }],
        properties: { cartography: "haul-grade", elevations_m: "[-12.5,-10]", width_m: 6 },
      }],
    } };
    const markup = render(world);
    expect(markup).toContain("Hauling to crusher");
    expect(markup).toContain("10 km/h");
    expect(markup).toContain("Relative elevation -12.5 m");
    expect(render(world, false)).not.toContain("point-cloud-activity");
  });
});
