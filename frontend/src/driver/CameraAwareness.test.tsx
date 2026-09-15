import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { defaultWorldState } from "../state/defaultState";
import type { WorldState } from "../types";
import { CameraAwareness } from "./CameraAwareness";

vi.mock("leaflet", () => ({ default: {} }));

function renderCamera(world: WorldState, connection: "CONNECTED" | "DISCONNECTED" = "CONNECTED") {
  return renderToStaticMarkup(
    <CameraAwareness
      world={world}
      readings={[]}
      points={[]}
      vehicle={world.vehicles[0] ?? defaultWorldState.vehicles[0]}
      sensorSettings={defaultSensorSettings().sensors}
      mode="CAMERA"
      onModeChange={() => undefined}
      connection={connection}
    />,
  );
}

describe("CameraAwareness camera source boundaries", () => {
  it("does not render simulated media while the world is LIVE", () => {
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
      vehicles: defaultWorldState.vehicles.map((vehicle) => ({ ...vehicle, mode: "LIVE" })),
    };

    const markup = renderCamera(liveWorld);

    expect(markup).not.toContain("camera-comparison-container");
    expect(markup).not.toContain("/camera/haul_truck_optical.png");
    expect(markup).not.toContain("/camera/haul_truck_ir.png");
    expect(markup).toContain("CAMERA UNAVAILABLE");
  });

  it("renders the comparison media only for a connected simulated camera", () => {
    const simulatedWorld: WorldState = {
      ...defaultWorldState,
      mode: "SIMULATED",
      camera: {
        ...defaultWorldState.camera,
        mode: "SIMULATED",
        stream_status: "simulated",
        raw_available: true,
      },
    };

    const markup = renderCamera(simulatedWorld);

    expect(markup).toContain("camera-comparison-container");
    expect(markup).toContain("/camera/haul_truck_optical.png");
    expect(markup).toContain("/camera/haul_truck_ir.png");
  });

  it("keeps the real stream path available for a LIVE camera", () => {
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
      vehicles: defaultWorldState.vehicles.map((vehicle) => ({ ...vehicle, mode: "LIVE" })),
    };

    const markup = renderCamera(liveWorld);

    expect(markup).toContain("camera-feed");
    expect(markup).toContain("/api/camera/stream?view=raw");
    expect(markup).not.toContain("camera-comparison-container");
    expect(markup).not.toContain("camera-unavailable");
  });
});
