import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { Vehicle3DTruck } from "./Vehicle3DTruck";

describe("Vehicle3DTruck 3D Model", () => {
  it("renders truck chassis, cab, wheels, and sensor pods", () => {
    const sensors = defaultSensorSettings().sensors;
    const markup = renderToStaticMarkup(
      <svg viewBox="0 0 1000 620">
        <Vehicle3DTruck
          sensors={sensors}
          readings={[]}
          callsign="DUMPER_01"
        />
      </svg>,
    );

    expect(markup).toContain("DUMPER_01");
    expect(markup).toContain("truck-dump-body");
    expect(markup).toContain("truck-cab-assembly");
    expect(markup).toContain("truck-wheels");
    expect(markup).toContain("truck-sensor-mounts");
  });

  it("activates danger alerts and perimeter shields when sensor threshold is breached", () => {
    const sensors = defaultSensorSettings().sensors;
    const readings = [
      {
        timestamp_ms: 100,
        sensor_id: "front_scanner" as const,
        angle_deg: 0,
        range_m: 0.45,
        quality: 0.95,
        max_range_m: 4,
        is_valid: true,
        mode: "LIVE" as const,
      },
    ];

    const markup = renderToStaticMarkup(
      <svg viewBox="0 0 1000 620">
        <Vehicle3DTruck
          sensors={sensors}
          readings={readings}
          callsign="DUMPER_01"
        />
      </svg>,
    );

    expect(markup).toContain("truck-alert-active");
    expect(markup).toContain("front-shield");
    expect(markup).toContain("sensor-alert-ring");
  });
});
