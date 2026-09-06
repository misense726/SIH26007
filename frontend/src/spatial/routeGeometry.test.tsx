import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import { HaulRoad, HaulTraffic } from "./HaulScene";
import { NavigationMap } from "./NavigationMap";
import { clipRoad, localPoint } from "./routeGeometry";
import { isWorldStateSnapshot } from "../state/worldStateSnapshot";
import type { WorldState } from "../types";
import { MineFleetMap } from "../twin/MineFleetMap";
import { createSupervisorViewModel } from "../supervisor/supervisorViewModel";

const vehicle = {
  ...defaultWorldState.vehicles[0],
  x_m: 0,
  y_m: 0,
  heading_deg: 0,
  position_confidence: 1,
};
const world: WorldState = {
  ...defaultWorldState,
  vehicles: [
    vehicle,
    { ...vehicle, vehicle_id: "DUMPER_02", x_m: 2.8, y_m: 4, heading_deg: 180 },
  ],
  haul_route: {
    origin: "Mine",
    destination: "Dump",
    phase: "OBSTACLE",
    distance_m: 10,
    total_distance_m: 40,
    remaining_m: 30,
    elapsed_s: 12,
    obstacle: { x_m: 0, y_m: 5 },
    obstacle_radius_m: 0.9,
    obstacle_detected: true,
    next_instruction: "Obstacle ahead. Prepare to stop",
  },
};

describe("mine route rendering", () => {
  it("renders the angled supervisor mine map and shares encounter guidance", () => {
    const model = createSupervisorViewModel(world);
    const markup = renderToStaticMarkup(
      <MineFleetMap
        features={[]}
        vehicles={model.vehicles}
        haul={world.haul_route}
      />,
    );
    expect(markup).toContain("Angled mine map");
    expect(markup).toContain("3D site");
    expect(markup).not.toMatch(/NaN|Infinity/);
    expect(model.issues.some((i) => i.id === "haul-encounter")).toBe(true);
  });
  it("uses the same vehicle-frame transform for road, truck and obstacle", () => {
    expect(
      localPoint({ x_m: 4, y_m: 0 }, { ...vehicle, heading_deg: 90 }).y_m,
    ).toBeCloseTo(4);
    const result = clipRoad([
      { x_m: -100, y_m: -100, z_m: 0 },
      { x_m: 100, y_m: -100, z_m: 0 },
      { x_m: 100, y_m: 100, z_m: 0 },
      { x_m: -100, y_m: 100, z_m: 0 },
    ]);
    expect(result).toHaveLength(4);
    expect(
      result.every((p) => Math.abs(p.x_m) <= 11 && Math.abs(p.y_m) <= 11),
    ).toBe(true);
  });
  it("renders approaching traffic and obstruction while preserving primary content", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <HaulRoad world={world} vehicle={vehicle} camera={{}} />
        <HaulTraffic world={world} vehicle={vehicle} camera={{}}>
          <g aria-label="primary truck" />
        </HaulTraffic>
      </svg>,
    );
    expect(markup).toContain("DUMPER_02 3D model");
    expect(markup).toContain("Road obstruction");
    expect(markup).toContain("primary truck");
    expect(markup).not.toContain('stroke="#7dd3fc"');
    expect(markup).not.toMatch(/NaN|Infinity/);
  });
  it("shows guidance and hides moving markers when telemetry disconnects", () => {
    const connected = renderToStaticMarkup(
      <NavigationMap world={world} vehicle={vehicle} connected />,
    );
    expect(connected).toContain("30 m");
    expect(connected).toContain("DUMPER_02 position");
    expect(connected).toContain("Obstruction on haul road");
    const offline = renderToStaticMarkup(
      <NavigationMap world={world} vehicle={vehicle} connected={false} />,
    );
    expect(offline).toContain("Navigation unavailable");
    expect(offline).not.toContain("DUMPER_02 position");
    expect(offline).not.toContain("Obstruction on haul road");
  });
  it("rejects non-finite route payloads at the telemetry boundary", () => {
    expect(isWorldStateSnapshot(world)).toBe(true);
    expect(
      isWorldStateSnapshot({
        ...world,
        haul_route: { ...world.haul_route, remaining_m: NaN },
      }),
    ).toBe(false);
    expect(
      isWorldStateSnapshot({
        ...world,
        haul_route: {
          ...world.haul_route,
          obstacle: { x_m: Infinity, y_m: 0 },
        },
      }),
    ).toBe(false);
  });
});
