import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DataMode, HaulRouteState } from "../types";
import { TwinMap } from "./TwinMap";

vi.mock("leaflet", () => ({ default: {} }));

const haul: HaulRouteState = {
  origin: "Mine",
  destination: "Crusher",
  phase: "HAULING",
  distance_m: 10,
  total_distance_m: 100,
  remaining_m: 90,
  elapsed_s: 8,
  obstacle: null,
  obstacle_radius_m: 0.3,
  obstacle_detected: false,
  next_instruction: "Continue to crusher",
};

describe("supervisor scene data source", () => {
  it("shows illustrative terrain only for a simulated haul route", () => {
    const markup = renderToStaticMarkup(
      <TwinMap
        mode="SIMULATED"
        haul={haul}
        vehicles={[]}
        features={[]}
        mapName="Mine"
      />,
    );
    expect(markup).toContain("mine-terrain-viewport");
    expect(markup).toContain("Active dumper");
  });

  it.each<DataMode>(["LIVE", "REPLAY"])(
    "does not add illustrative scenery to %s telemetry",
    (mode) => {
      const markup = renderToStaticMarkup(
        <TwinMap
          mode={mode}
          haul={haul}
          vehicles={[]}
          features={[]}
          mapName="Reference map"
        />,
      );
      expect(markup).not.toContain("mine-terrain-viewport");
      expect(markup).not.toContain("Continue to crusher");
      expect(markup).toContain("Reference map");
    },
  );

  it("keeps other simulation scenarios on their reference map", () => {
    const markup = renderToStaticMarkup(
      <TwinMap mode="SIMULATED" vehicles={[]} features={[]} mapName="Campus" />,
    );
    expect(markup).not.toContain("mine-terrain-viewport");
    expect(markup).toContain("Campus");
  });
});
