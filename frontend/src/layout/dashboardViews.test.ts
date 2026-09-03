import { describe, expect, it } from "vitest";
import {
  dashboardViewHash,
  dashboardViewLabel,
  dashboardViewsForRole,
  resolveDashboardRoute,
} from "./dashboardViews";

describe("dashboard navigation", () => {
  it("maps every view to a stable deep link", () => {
    expect(dashboardViewHash("DRIVER")).toBe("#driver");
    expect(dashboardViewHash("SPATIAL")).toBe("#spatial");
    expect(dashboardViewHash("SUPERVISOR")).toBe("#fleet");
    expect(dashboardViewHash("SETTINGS")).toBe("#calibration");
    expect(dashboardViewLabel("SUPERVISOR")).toBe("Fleet");
  });

  it("assigns awareness tools to Driver and fleet operations to Supervisor", () => {
    expect(dashboardViewsForRole("DRIVER").map((view) => view.value)).toEqual([
      "DRIVER",
      "SPATIAL",
      "SETTINGS",
    ]);
    expect(dashboardViewsForRole("SUPERVISOR").map((view) => view.value)).toEqual([
      "SUPERVISOR",
    ]);
  });

  it("normalizes allowed, forbidden, and unknown destinations by role", () => {
    expect(resolveDashboardRoute("DRIVER", "#SPATIAL")).toEqual({
      view: "SPATIAL",
      hash: "#spatial",
    });
    expect(resolveDashboardRoute("DRIVER", "#fleet")).toEqual({
      view: "DRIVER",
      hash: "#driver",
    });
    expect(resolveDashboardRoute("SUPERVISOR", "#unknown")).toEqual({
      view: "SUPERVISOR",
      hash: "#fleet",
    });
  });
});
