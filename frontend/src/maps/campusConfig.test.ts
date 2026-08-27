import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPUS_CONFIG } from "./campusConfig";
import { cartesianToGeodetic, geodeticToCartesian } from "./locationProvider";

describe("Chennai road map configuration", () => {
  it("uses the requested V699+X9 Chennai site", () => {
    expect(DEFAULT_CAMPUS_CONFIG.locationCode).toBe("V699+X9");
    expect(DEFAULT_CAMPUS_CONFIG.locationLabel).toBe("V699+X9, Chennai, Tamil Nadu");
    expect(DEFAULT_CAMPUS_CONFIG.siteCenter.lat).toBeCloseTo(12.86965, 6);
    expect(DEFAULT_CAMPUS_CONFIG.siteCenter.lng).toBeCloseTo(80.219921875, 6);
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
