import { describe, expect, it } from "vitest";
import { defaultWorldState } from "./defaultState";

describe("default world state", () => {
  it("labels disconnected placeholder data as simulated", () => {
    expect(defaultWorldState.mode).toBe("SIMULATED");
    expect(defaultWorldState.vehicle.mode).toBe("SIMULATED");
  });
});

