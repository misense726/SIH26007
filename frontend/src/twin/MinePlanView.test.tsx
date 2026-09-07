import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MinePlanView } from "./MinePlanView";
import { placeLabels, planBounds, scaleDistance } from "./planLayout";
import { PlanLegend } from "./PlanSymbols";
import { ReferenceMapLegend } from "./ReferenceMapLegend";
import { defaultWorldState } from "../state/defaultState";
import { createSupervisorViewModel } from "../supervisor/supervisorViewModel";
import type { MapFeature } from "../types";

const features: MapFeature[] = [
  {
    feature_id: "road",
    feature_type: "ROAD",
    geometry_type: "POLYGON",
    points: [
      { x_m: 0, y_m: 0 },
      { x_m: 10, y_m: 0 },
      { x_m: 10, y_m: 50 },
      { x_m: 0, y_m: 50 },
    ],
    label: "Haul road",
    properties: {},
  },
  {
    feature_id: "start",
    feature_type: "START",
    geometry_type: "POINT",
    points: [{ x_m: 5, y_m: 0 }],
    label: "Mine loading bay",
    properties: {},
  },
  {
    feature_id: "end",
    feature_type: "DESTINATION",
    geometry_type: "POINT",
    points: [{ x_m: 5, y_m: 50 }],
    label: "Crusher",
    properties: {},
  },
  {
    feature_id: "route",
    feature_type: "ROUTE",
    geometry_type: "POLYLINE",
    points: [
      { x_m: 5, y_m: 0 },
      { x_m: 5, y_m: 50 },
    ],
    label: "Route",
    properties: {},
  },
];

describe("2D mine plan", () => {
  it("fits operational geometry without distant decorative contours shrinking it", () => {
    const contour: MapFeature = {
      ...features[0],
      feature_id: "contour",
      feature_type: "TERRAIN",
      properties: { cartography: "contour" },
      points: [{ x_m: 1000, y_m: 1000 }],
    };
    expect(planBounds([...features, contour])).toEqual(planBounds(features));
    expect(planBounds([])).toEqual({ x: 0, y: 0, width: 40, height: 40 });
  });
  it("keeps a useful metric scale as zoom changes", () => {
    for (const scale of [0.1, 0.5, 2, 8, 20, 100]) {
      const distance = scaleDistance(scale);
      expect(distance * scale).toBeGreaterThanOrEqual(30);
      expect(distance * scale).toBeLessThanOrEqual(90);
    }
  });
  it("separates coincident labels and contains edge labels", () => {
    const result = placeLabels(
      [
        { id: "mine", text: "Mine loading bay", x: 400, y: 250 },
        { id: "truck", text: "DUMPER_01", x: 400, y: 250 },
        { id: "edge", text: "Crusher", x: 795, y: 490 },
      ],
      800,
      500,
    );
    for (const label of result) {
      expect(label.left).toBeGreaterThanOrEqual(8);
      expect(label.left + label.width).toBeLessThanOrEqual(792);
      expect(label.top + label.height).toBeLessThanOrEqual(450);
    }
    const [a, b] = result;
    expect(
      a.left + a.width <= b.left ||
        b.left + b.width <= a.left ||
        a.top + a.height <= b.top ||
        b.top + b.height <= a.top,
    ).toBe(true);
  });
  it("renders heading, matching symbols, readable sites and a route that can be hidden", () => {
    const vehicles = createSupervisorViewModel(defaultWorldState).vehicles;
    const props = {
      features,
      vehicles,
      selectedTruckId: vehicles[0]?.vehicleId,
      zoom: 1,
      pan: { x: 0, y: 0 },
      onPan: () => {},
    };
    const shown = renderToStaticMarkup(
      <MinePlanView {...props} routeVisible />,
    );
    const hidden = renderToStaticMarkup(
      <MinePlanView {...props} routeVisible={false} />,
    );
    expect(shown).toContain('class="plan-route"');
    expect(hidden).not.toContain('class="plan-route"');
    expect(shown).toContain("Crusher / unloading");
    expect(shown).toContain("Mine loading bay");
    expect(shown).toContain("Local +Y");
    expect(shown).toContain("metre scale");
    expect(shown).toContain('aria-pressed="true"');
    expect(shown).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("keeps legend entries consistent with route visibility and actual reference features", () => {
    expect(
      renderToStaticMarkup(<PlanLegend routeVisible={false} />),
    ).not.toContain("Assigned route");
    const live = renderToStaticMarkup(
      <ReferenceMapLegend features={features} />,
    );
    expect(live).toContain("Assigned route");
    expect(live).toContain("Selected vehicle");
    expect(live).not.toContain("Hazard zone");
    expect(live).not.toContain("Rock encounter");
  });
});
