import { describe, expect, it } from "vitest";
import {
  dashboardViewFromHash,
  dashboardViewHash,
  dashboardViewLabel,
} from "./dashboardViews";

describe("dashboard navigation", () => {
  it("maps every view to a stable deep link", () => {
    expect(dashboardViewHash("DRIVER")).toBe("#driver");
    expect(dashboardViewHash("SPATIAL")).toBe("#spatial");
    expect(dashboardViewHash("SUPERVISOR")).toBe("#fleet");
    expect(dashboardViewHash("SETTINGS")).toBe("#calibration");
  });

  it("reads deep links without depending on letter case", () => {
    expect(dashboardViewFromHash("#SPATIAL")).toBe("SPATIAL");
    expect(dashboardViewFromHash("#fleet")).toBe("SUPERVISOR");
  });

  it("falls back to the driver view for empty or unknown links", () => {
    expect(dashboardViewFromHash("")).toBe("DRIVER");
    expect(dashboardViewFromHash("#unknown")).toBe("DRIVER");
    expect(dashboardViewLabel("DRIVER")).toBe("Awareness");
  });
});
