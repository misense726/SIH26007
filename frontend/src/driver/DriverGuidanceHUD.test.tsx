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
