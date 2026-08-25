import { describe, expect, it, vi } from "vitest";
import type { SimulationState } from "../types";
import {
  loadSimulationState,
  movementControl,
  resetControl,
  scenarioControl,
  sendSimulationControl,
} from "./simulationApi";

const normalState: SimulationState = {
  running: true,
  scenario: "NORMAL",
  speed_scale: 1,
  obstacle_enabled: false,
  visibility_score: 0.88,
  front_scanner_angle_deg: -30,
  rear_scanner_angle_deg: 30,
};

function response(body: SimulationState, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("simulation API", () => {
  it("loads the current control state", async () => {
    const request = vi.fn(async () => response(normalState));

    await expect(loadSimulationState(request)).resolves.toEqual(normalState);
    expect(request).toHaveBeenCalledWith("/api/simulation");
  });

  it("posts only the requested scenario field", async () => {
    const fogState = { ...normalState, scenario: "FOG" as const };
    const request = vi.fn(async () => response(fogState));

    await expect(sendSimulationControl(scenarioControl("FOG"), request)).resolves.toEqual(fogState);
    expect(request).toHaveBeenCalledWith("/api/simulation/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "FOG" }),
    });
  });

  it("builds pause, resume, and reset controls from the current state", () => {
    expect(movementControl(true)).toEqual({ running: false });
    expect(movementControl(false)).toEqual({ running: true });
    expect(resetControl()).toEqual({ reset: true });
  });

  it("rejects failed control requests", async () => {
    const request = vi.fn(async () => response(normalState, false, 503));

    await expect(sendSimulationControl({ reset: true }, request)).rejects.toThrow("status 503");
  });
});
