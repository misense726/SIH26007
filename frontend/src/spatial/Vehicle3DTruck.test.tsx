import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { Vehicle3DTruck } from "./Vehicle3DTruck";
import { buildTruckMesh, surfaceNormal } from "./truckMesh";

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
    expect(new Set(markup.match(/data-part="wheel-[^"]+"/g)).size).toBe(6);
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
        expect(new Set(markup.match(/data-part="wheel-[^"]+"/g)).size).toBe(6);
        expect(markup.match(/sensor-pod-3d/g)).toHaveLength(5);
      }
    }
  });

  it("keeps each round tire closed with outward-facing surfaces", () => {
    const mesh = buildTruckMesh();
    const wheels = [...new Set(mesh.filter((f) => f.part.startsWith("wheel-")).map((f) => f.part))];
    expect(wheels).toHaveLength(6);
    for (const wheel of wheels) {
      const faces = mesh.filter((f) => f.part === wheel);
      const vertices = faces.flatMap((f) => f.points);
      const center = {
        x_m: (Math.min(...vertices.map((p) => p.x_m)) + Math.max(...vertices.map((p) => p.x_m))) / 2,
        y_m: (Math.min(...vertices.map((p) => p.y_m)) + Math.max(...vertices.map((p) => p.y_m))) / 2,
        z_m: (Math.min(...vertices.map((p) => p.z_m)) + Math.max(...vertices.map((p) => p.z_m))) / 2,
      };
      const edges = new Map<string, number>();
      const vertexKey = (p: typeof center) => [p.x_m, p.y_m, p.z_m].map((n) => n.toFixed(5)).join(",");
      for (const face of faces) {
        const normal = surfaceNormal(face.points);
        const p = face.points[0];
        expect(normal.x_m * (p.x_m - center.x_m) + normal.y_m * (p.y_m - center.y_m) + normal.z_m * (p.z_m - center.z_m)).toBeGreaterThan(0);
        face.points.forEach((p, i) => {
          const key = [vertexKey(p), vertexKey(face.points[(i + 1) % face.points.length])].sort().join("|");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        });
      }
      expect([...edges.values()].every((count) => count === 2)).toBe(true);
      // Multiple radial heights distinguish circular tires from the previous boxes.
      expect(new Set(vertices.map((p) => p.z_m.toFixed(5))).size).toBeGreaterThan(20);
    }
  });

  it("steers only the front wheels and tolerates invalid steering and attitude", () => {
    const straight = buildTruckMesh(0);
    const steered = buildTruckMesh(25);
    expect(steered.filter((f) => !f.part.startsWith("wheel-front")))
      .toEqual(straight.filter((f) => !f.part.startsWith("wheel-front")));
    expect(steered.filter((f) => f.part.startsWith("wheel-front")))
      .not.toEqual(straight.filter((f) => f.part.startsWith("wheel-front")));
    expect(buildTruckMesh(Number.NaN)).toEqual(straight);
    const markup = renderToStaticMarkup(<svg><Vehicle3DTruck sensors={[]} readings={[]}
      steerAngleDeg={Number.NaN} imuOrientation={{ pitch_deg: Number.NaN, roll_deg: Infinity, yaw_deg: Number.NaN }}
      cameraConfig={{ orbitYawDeg: Number.NaN, cameraPitchDeg: Infinity }} /></svg>);
    expect(markup).not.toMatch(/NaN|Infinity/);
    expect(markup).toContain("truck-solid-core");
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
    expect(markup).toContain("sensor-pod-unknown");
    expect(markup).toContain('stroke="#94a3b8"');
  });
});
