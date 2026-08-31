import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import type { WorldState } from "../types";
import { SensorSettingsPage } from "./SensorSettingsPage";
import { defaultSensorSettings } from "./sensorSettingsApi";

const worldWithHealthyRange: WorldState = {
  ...defaultWorldState,
  ranges: [{
    timestamp_ms: 10,
    sensor_id: "front_scanner",
    angle_deg: 15,
    range_m: 1.42,
    quality: 0.94,
    max_range_m: 4,
    is_valid: true,
    mode: "LIVE",
  }],
  sensor_health: [{
    sensor_id: "front_scanner",
    status: "HEALTHY",
    last_update_ms: 10,
    confidence: 0.94,
    detail: null,
  }],
};

const noopAsync = async () => undefined;

describe("sensor settings telemetry states", () => {
  it("hides cached range and health values after disconnect", () => {
    const markup = renderToStaticMarkup(
      <SensorSettingsPage
        world={worldWithHealthyRange}
        telemetryConnection="DISCONNECTED"
        settings={defaultSensorSettings()}
        settingsConnection="SAVED"
        message={null}
        onSensorChange={() => undefined}
        onSensorSave={noopAsync}
        onZeroImu={noopAsync}
      />,
    );

    expect(markup).toContain("Unknown");
    expect(markup).toContain("health-offline");
    expect(markup).not.toContain("health-healthy");
    expect(markup).not.toContain("1.42 m");
  });

  it("blocks an alert distance beyond the visual range", () => {
    const settings = defaultSensorSettings();
    settings.sensors[0] = {
      ...settings.sensors[0],
      alert_distance_m: 5,
      visual_range_m: 4,
    };

    const markup = renderToStaticMarkup(
      <SensorSettingsPage
        world={defaultWorldState}
        telemetryConnection="CONNECTED"
        settings={settings}
        settingsConnection="SAVED"
        message={null}
        onSensorChange={() => undefined}
        onSensorSave={noopAsync}
        onZeroImu={noopAsync}
      />,
    );

    expect(markup).toContain("Alert distance must not exceed visual range.");
    expect(markup).toMatch(/disabled=""[^>]*>Save Front scanner<\/button>/);
  });
});
