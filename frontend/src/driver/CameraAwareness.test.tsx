import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import type { WorldState } from "../types";
import type { AwarenessMode } from "./driverAwareness";
import { CameraAwareness } from "./CameraAwareness";

vi.mock("leaflet", () => ({ default: {} }));

function renderAwareness(
  world: WorldState,
  mode: AwarenessMode = "CAMERA",
  connection: "CONNECTED" | "DISCONNECTED" = "CONNECTED",
) {
  return renderToStaticMarkup(
    <CameraAwareness
      world={world}
      vehicle={world.vehicles[0] ?? defaultWorldState.vehicles[0]}
      mode={mode}
      onModeChange={() => undefined}
      connection={connection}
    />,
  );
}

function simulatedWorld(): WorldState {
  return {
    ...defaultWorldState,
    mode: "SIMULATED",
    camera: {
      ...defaultWorldState.camera,
      mode: "SIMULATED",
      stream_status: "simulated",
      raw_available: true,
    },
  };
}

describe("CameraAwareness display modes", () => {
  it("shows exactly Camera and LiDAR controls", () => {
    const markup = renderAwareness(simulatedWorld());
    const group = markup
      .split('aria-label="Driver awareness display"')[1]
      .split("</div>")[0];

    expect(group.match(/<button/g)).toHaveLength(2);
    expect(group).toContain(">Camera</button>");
    expect(group).toContain(">LiDAR</button>");
    expect(group.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/Auto|ToF overlay|Raw|Dehazed|False color|IR \(GPU\)|Thermal|GPU/);
  });

  it("uses the monochrome simulated camera asset", () => {
    const markup = renderAwareness(simulatedWorld());

    expect(markup).toContain("MONO CAMERA SIMULATED");
    expect(markup).toContain("/camera/haul_truck_ir.png");
    expect(markup).not.toContain("/camera/haul_truck_optical.png");
    expect(markup).toContain("Monochrome forward camera feed");
  });

  it("uses the raw live stream as the monochrome source", () => {
    const liveWorld: WorldState = {
      ...defaultWorldState,
      mode: "LIVE",
      camera: {
        ...defaultWorldState.camera,
        mode: "LIVE",
        stream_status: "live",
        raw_available: true,
        width_px: 1280,
        height_px: 720,
        measured_fps: 15,
      },
      environment: { ...defaultWorldState.environment, mode: "LIVE" },
      vehicles: defaultWorldState.vehicles.map((vehicle) => ({
        ...vehicle,
        mode: "LIVE",
      })),
    };

    const markup = renderAwareness(liveWorld);

    expect(markup).toContain("MONO CAMERA LIVE");
    expect(markup).toContain("/api/camera/stream?view=raw");
    expect(markup).not.toContain("view=ir");
  });

  it("uses the live IR stream when the camera provides it", () => {
    const liveWorld: WorldState = {
      ...defaultWorldState,
      mode: "LIVE",
      camera: { ...defaultWorldState.camera, mode: "LIVE", raw_available: true,
        ir_available: true, ir_fps: 12, ir_latency_ms: 42 },
    };
    const markup = renderAwareness(liveWorld);
    expect(markup).toContain("IR CAMERA LIVE");
    expect(markup).toContain("/api/camera/stream?view=ir");
    expect(markup).toContain("IR camera output from the forward camera");
  });

  it("renders LiDAR independently of camera availability", () => {
    const world = {
      ...simulatedWorld(),
      camera: {
        ...simulatedWorld().camera,
        raw_available: false,
        stream_status: "disabled" as const,
      },
    };
    const markup = renderAwareness(world, "LIDAR");

    expect(markup).toContain("LIDAR SIMULATED");
    expect(markup).toContain("Vehicle-centered LiDAR view");
    expect(markup).not.toContain("CAMERA UNAVAILABLE");
    expect(markup).not.toContain("Monochrome forward camera feed");
  });

  it("does not render simulated media while the world is live", () => {
    const liveWorld: WorldState = {
      ...defaultWorldState,
      mode: "LIVE",
      camera: {
        ...defaultWorldState.camera,
        mode: "SIMULATED",
        stream_status: "simulated",
        raw_available: true,
      },
      environment: { ...defaultWorldState.environment, mode: "LIVE" },
      vehicles: defaultWorldState.vehicles.map((vehicle) => ({
        ...vehicle,
        mode: "LIVE",
      })),
    };

    const markup = renderAwareness(liveWorld);

    expect(markup).not.toContain("/camera/haul_truck_ir.png");
    expect(markup).toContain("CAMERA UNAVAILABLE");
  });
});
