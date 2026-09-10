import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import { createSupervisorViewModel } from "./supervisorViewModel";
import { HaulEfficiencyPanel, TRUCK_MODELS } from "./HaulEfficiencyPanel";

describe("HaulEfficiencyPanel", () => {
  const model = createSupervisorViewModel({
    ...defaultWorldState,
    vehicles: [
      { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_01" },
      { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_02" },
      { ...defaultWorldState.vehicles[0], vehicle_id: "HAULER_09" },
    ],
  });

  it("renders vehicle dropdown with fleet options", () => {
    const markup = renderToStaticMarkup(
      <HaulEfficiencyPanel vehicles={model.vehicles} world={defaultWorldState} />,
    );

    expect(markup).toContain("id=\"efficiency-vehicle-select\"");
    expect(markup).toContain("DUMPER_01");
    expect(markup).toContain("DUMPER_02");
    expect(markup).toContain("HAULER_09");
    expect(markup).toContain("Caterpillar 777D/777E");
  });

  it("renders all three real-world truck models in the selector", () => {
    const markup = renderToStaticMarkup(
      <HaulEfficiencyPanel vehicles={model.vehicles} world={defaultWorldState} />,
    );

    for (const truck of TRUCK_MODELS) {
      expect(markup).toContain(truck.name.split("/")[0].replace("Caterpillar", "Cat"));
    }
    expect(markup).toContain("Cat 777D");
    expect(markup).toContain("BEML BH100");
    expect(markup).toContain("Komatsu HD785");
  });

  it("renders two side-by-side charts for live telemetry and model frontier", () => {
    const markup = renderToStaticMarkup(
      <HaulEfficiencyPanel vehicles={model.vehicles} world={defaultWorldState} />,
    );

    expect(markup).toContain("Live Haul Performance");
    expect(markup).toContain("Efficiency Frontier Curve");
    expect(markup).toContain("left-plot-panel");
    expect(markup).toContain("right-plot-panel");
    expect(markup).toContain("Sweet spot target");
    expect(markup).toContain("★ SWEET SPOT");
    expect(markup).toContain("NOW");
  });

  it("shows sweet spot values and classification details", () => {
    const markup = renderToStaticMarkup(
      <HaulEfficiencyPanel vehicles={model.vehicles} world={defaultWorldState} />,
    );

    expect(markup).toContain("Bailadila Deposit-14");
    expect(markup).toContain("Model Sweet Spot");
    expect(markup).toContain("t·km/L");
    expect(markup).toContain("Total Ore Transported");
  });

  it("handles empty fleet gracefully", () => {
    const markup = renderToStaticMarkup(
      <HaulEfficiencyPanel vehicles={[]} world={defaultWorldState} />,
    );

    expect(markup).toContain("No fleet vehicles online");
  });
});
