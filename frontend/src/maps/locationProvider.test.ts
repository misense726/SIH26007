import { describe, expect, it } from "vitest";
import {
  cartesianToGeodetic,
  formatCoordinates,
  geodeticToCartesian,
  type GeoCoordinates,
} from "./locationProvider";

describe("locationProvider geodetic transformations", () => {
  const testAnchor: GeoCoordinates = {
    lat: 28.5458,
    lng: 77.1926,
    altitude_m: 218.0,
  };

  it("converts (0, 0) Cartesian offset to identical anchor coordinates", () => {
    const geo = cartesianToGeodetic(0, 0, testAnchor);
    expect(geo.lat).toBeCloseTo(testAnchor.lat, 6);
    expect(geo.lng).toBeCloseTo(testAnchor.lng, 6);
    expect(geo.altitude_m).toBe(testAnchor.altitude_m);
  });

  it("converts non-zero Cartesian offsets accurately and inverts cleanly", () => {
    const x_m = 50.0;
    const y_m = 100.0;

    const geo = cartesianToGeodetic(x_m, y_m, testAnchor);
    expect(geo.lat).toBeGreaterThan(testAnchor.lat);
    expect(geo.lng).toBeGreaterThan(testAnchor.lng);

    const backToCartesian = geodeticToCartesian(geo, testAnchor);
    expect(backToCartesian.x_m).toBeCloseTo(x_m, 2);
    expect(backToCartesian.y_m).toBeCloseTo(y_m, 2);
  });

  it("formats GPS coordinates into clean standard notation", () => {
    const coords: GeoCoordinates = { lat: 28.5458, lng: 77.1926 };
    const formatted = formatCoordinates(coords, 4);
    expect(formatted).toBe("28.5458° N, 77.1926° E");
  });
});
