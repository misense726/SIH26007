import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPUS_CONFIG } from "./campusConfig";
import { cartesianToGeodetic, geodeticToCartesian } from "./locationProvider";

describe("Bailadila iron ore mines map configuration", () => {
  it("uses the Bailadila mining complex site", () => {
    expect(DEFAULT_CAMPUS_CONFIG.locationCode).toBe("Bailadila");
    expect(DEFAULT_CAMPUS_CONFIG.locationLabel).toBe("Bailadila, Dantewada, Chhattisgarh");
    expect(DEFAULT_CAMPUS_CONFIG.siteCenter.lat).toBeCloseTo(18.6731, 4);
    expect(DEFAULT_CAMPUS_CONFIG.siteCenter.lng).toBeCloseTo(81.2481, 4);
  });

  it("places the route start near the site center and caps close zoom", () => {
    const routeStart = cartesianToGeodetic(5, 1, DEFAULT_CAMPUS_CONFIG.anchor);
    const siteOffset = geodeticToCartesian(
      DEFAULT_CAMPUS_CONFIG.siteCenter,
      routeStart,
    );
    expect(Math.hypot(siteOffset.x_m, siteOffset.y_m)).toBeLessThan(15);
    expect(DEFAULT_CAMPUS_CONFIG.maxZoom).toBe(18);
    expect(DEFAULT_CAMPUS_CONFIG.tiles.name).toBe("Road map");
  });
});
