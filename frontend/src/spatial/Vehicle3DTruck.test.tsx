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
    expect(markup).toContain("truck-solid-core");
    expect(markup.match(/truck-tire-face/g)).toHaveLength(36);
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

  it("renders the undercarriage when the camera moves below the truck", () => {
    const sensors = defaultSensorSettings().sensors;
    const markup = renderToStaticMarkup(
      <svg viewBox="0 0 1000 620">
        <Vehicle3DTruck
          sensors={sensors}
          readings={[]}
          callsign="DUMPER_01"
          cameraConfig={{ cameraPitchDeg: -65 }}
        />
      </svg>,
    );

    expect(markup).toContain("truck-undercarriage");
  });

  it("keeps complete finite geometry through the full camera sweep", () => {
    const sensors = defaultSensorSettings().sensors;
    const pitches = [-85, -45, 0, 35, 85];

    for (let orbitYawDeg = 0; orbitYawDeg < 360; orbitYawDeg += 45) {
      for (const cameraPitchDeg of pitches) {
        const markup = renderToStaticMarkup(
          <svg viewBox="0 0 1000 620">
            <Vehicle3DTruck
              sensors={sensors}
              readings={[]}
              cameraConfig={{ orbitYawDeg, cameraPitchDeg }}
            />
          </svg>,
        );

        expect(markup).not.toMatch(/NaN|Infinity/);
        expect(markup).toContain("truck-solid-core");
        expect(markup.match(/truck-tire-assembly/g)).toHaveLength(6);
        expect(markup.match(/sensor-pod-3d/g)).toHaveLength(5);
      }
    }
  });

  it("renders malformed live sensor data as an unknown return without breaking geometry", () => {
    const sensors = defaultSensorSettings().sensors;
    const markup = renderToStaticMarkup(
      <svg viewBox="0 0 1000 620">
        <Vehicle3DTruck
          sensors={sensors}
          readings={[
            {
              timestamp_ms: 1,
              sensor_id: "front_scanner",
              angle_deg: Number.NaN,
              range_m: Number.NaN,
              quality: 1,
              max_range_m: 4,
              is_valid: true,
              mode: "LIVE",
            },
          ]}
        />
      </svg>,
    );

    expect(markup).not.toMatch(/NaN|Infinity/);
    expect(markup).toContain("Front scanner: UNKNOWN (no return)");
  });
});
