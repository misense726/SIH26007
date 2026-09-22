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
});
