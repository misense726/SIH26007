import { describe, expect, it } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import type { WorldState } from "../types";
import { selectSimulatedForwardHazard } from "./forwardHazard";

const ego = { ...defaultWorldState.vehicles[0], position_confidence: 1 };
const world = (changes: Partial<WorldState> = {}): WorldState => ({
  ...defaultWorldState, mode: "SIMULATED", vehicles: [ego], ...changes,
});

describe("simulated forward hazard", () => {
  it("ignores rapidly changing berm warnings when no rock or truck is ahead", () => {
    for (const state of ["WARNING", "SAFE", "CRITICAL", "SAFE"] as const) {
      const snapshot = world({ emergency: { ...defaultWorldState.emergency, state,
        reason: state === "SAFE" ? null : "Forward obstacle is inside the warning distance" } });
      expect(selectSimulatedForwardHazard(snapshot, ego)).toBeNull();
    }
  });

  it("tracks only trucks in the forward lane and holds the alert near its boundary", () => {
    const ahead = { ...ego, vehicle_id: "DUMPER_02", y_m: 5 };
    const first = selectSimulatedForwardHazard(world({ generated_at_ms: 1000, vehicles: [ego, ahead] }), ego);
    expect(first?.kind).toBe("TRUCK");
    expect(first?.id).toBe("truck:DUMPER_02");
    expect(selectSimulatedForwardHazard(world({ generated_at_ms: 1500,
      vehicles: [ego, { ...ahead, y_m: 8.5 }] }), ego, first)?.id)
      .toBe(first?.id);
    const held = selectSimulatedForwardHazard(world({ generated_at_ms: 2000,
      vehicles: [ego, { ...ahead, y_m: -3 }] }), ego, first);
    expect(held?.title).toBe("Truck encounter");
    expect(held?.detail).not.toContain("ahead");
    expect(selectSimulatedForwardHazard(world({ generated_at_ms: 9000,
      vehicles: [ego, { ...ahead, y_m: -3 }] }), ego, held)).toBeNull();
    expect(selectSimulatedForwardHazard(world({ vehicles: [ego, { ...ahead, x_m: 4 }] }), ego))
      .toBeNull();
  });

  it("warns for the mapped floor rock only while it lies ahead", () => {
    const haul_route = { origin: "Pit", destination: "Crusher", phase: "OBSTACLE" as const,
      distance_m: 0, total_distance_m: 100, remaining_m: 100, elapsed_s: 0,
      obstacle: { x_m: 0, y_m: 6 }, obstacle_radius_m: 0.5,
      obstacle_detected: true, next_instruction: "Pass rock" };
    expect(selectSimulatedForwardHazard(world({ haul_route }), ego)?.kind).toBe("ROCK");
    expect(selectSimulatedForwardHazard(world({ haul_route: { ...haul_route,
      obstacle_detected: false } }), ego)).toBeNull();
    expect(selectSimulatedForwardHazard(world({ haul_route: { ...haul_route,
      obstacle: { x_m: 2.5, y_m: 6 } } }), ego)?.kind).toBe("ROCK");
    expect(selectSimulatedForwardHazard(world({ haul_route: { ...haul_route,
      obstacle: { x_m: 3.5, y_m: 6 } } }), ego)).toBeNull();
    expect(selectSimulatedForwardHazard(world({ ...{ haul_route }, mode: "LIVE" }), ego)).toBeNull();
  });
});
