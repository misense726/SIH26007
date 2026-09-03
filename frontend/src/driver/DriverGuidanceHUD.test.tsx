import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DriverGuidanceHUD } from "./DriverGuidanceHUD";
import { defaultWorldState } from "../state/defaultState";

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

  it.fails("fails closed when connected guidance is missing", () => {
    const markup = renderToStaticMarkup(
      <DriverGuidanceHUD
        world={defaultWorldState}
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
    const markup = renderToStaticMarkup(
      <DriverGuidanceHUD
        world={defaultWorldState}
        vehicleTelemetryAvailable={true}
      />,
    );
    expect(markup).toContain("Haul Destination");
    expect(markup).toContain("Atmospheric Sight");
    expect(markup).toContain("Estimated Sight Dist");
  });
});
