import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { defaultWorldState } from "../state/defaultState";
import { SpatialDashboard } from "./SpatialDashboard";

describe("SpatialDashboard scanner motion", () => {
  it("keeps the latest scanner angle when that range sample is invalid", () => {
    const sensorSettings = defaultSensorSettings().sensors;
    const world = {
      ...defaultWorldState,
      generated_at_ms: 1_000,
      mode: "LIVE" as const,
      ranges: [
        {
          timestamp_ms: 1_000,
          sensor_id: "front_scanner" as const,
          angle_deg: 50,
          range_m: 0,
          quality: 0,
          max_range_m: 4,
          is_valid: false,
          mode: "LIVE" as const,
        },
      ],
      sensor_health: [
        {
          sensor_id: "front_scanner",
          status: "HEALTHY" as const,
          last_update_ms: 1_000,
          confidence: 1,
          detail: null,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <SpatialDashboard
        world={world}
        connection="CONNECTED"
        sensorSettings={sensorSettings}
      />,
    );

    expect(markup).toContain("Front scanner head 50°");
  });
});
