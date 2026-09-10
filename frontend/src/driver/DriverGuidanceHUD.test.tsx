import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DriverGuidanceHUD } from "./DriverGuidanceHUD";
import { defaultWorldState } from "../state/defaultState";
import type { WorldState } from "../types";

describe("DriverGuidanceHUD", () => {
  it("renders UNVERIFIED fail-closed banner when vehicle telemetry is unavailable", () => {
    const markup = renderToStaticMarkup(
      <DriverGuidanceHUD
        world={defaultWorldState}
        vehicleTelemetryAvailable={false}
      />,
    );
    expect(markup).toContain("UNVERIFIED");
    expect(markup).toContain("Tactical Guidance");
    expect(markup).not.toContain(">SAFE<");
    expect(markup).not.toContain("Primary Crusher #01");
    expect(markup).not.toContain("green safe corridor");
    expect(markup).not.toContain("Haul corridor clear");
  });

  it("fails closed when connected guidance is missing", () => {
    const worldWithoutGuidance: WorldState = {
      ...defaultWorldState,
      operations: undefined,
    };
    const markup = renderToStaticMarkup(
      <DriverGuidanceHUD
        world={worldWithoutGuidance}
        vehicleTelemetryAvailable={true}
      />,
    );

    expect(markup).toContain("UNVERIFIED");
    expect(markup).not.toContain(">SAFE<");
    expect(markup).not.toContain("Primary Crusher #01");
    expect(markup).not.toContain("green safe corridor");
    expect(markup).not.toContain("Haul corridor clear");
  });

  it("renders collision warning card, destination, and atmospheric sight when connected", () => {
    const connectedWorld: WorldState = {
      ...defaultWorldState,
      operations: {
        network: null,
        fleet: {},
        routes: {},
        guidance: {
          DUMPER_01: {
            vehicle_id: "DUMPER_01",
            callsign: "Bailadila Shovel Hauler #01",
            current_destination: "Primary Crusher #01",
            distance_remaining_m: 120.0,
            next_instruction: "Follow green safe corridor.",
            speed_kmh: 24.0,
            target_vehicle_id: "NONE",
            target_callsign: "No Hazard",
            hazard_distance_m: 999.0,
            hazard_direction: "FRONT",
            closing_velocity_mps: 0.0,
            threat_level: "SAFE",
            advisory_text: "Corridor clear.",
            visibility_score: 0.88,
            visibility_state: "GOOD",
            estimated_sight_distance_m: 105.0,
          },
        },
        reroute_advisories: [],
        analytics_summary: {
          total_completed_cycles: 0,
          total_ore_moved_tonnes: 0,
          avg_cycle_time_minutes: 0,
          fleet_utilization_pct: 0,
          total_distance_km: 0,
          route_compliance_pct: null,
          active_fleet_count: 0,
          hourly_production_rate_tph: 0,
          recent_delay_events: [],
        },
        provenance: "SIMULATED_RUNTIME",
        network_version: 1,
      },
    };
    const markup = renderToStaticMarkup(
      <DriverGuidanceHUD
        world={connectedWorld}
        vehicleTelemetryAvailable={true}
      />,
    );
    expect(markup).toContain("Haul Destination");
    expect(markup).toContain("Atmospheric Sight");
    expect(markup).toContain("Estimated Sight Dist");
  });
});
