import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AUTO_SLIDER_HOLD_MS,
  AUTO_SLIDER_MAX,
  AUTO_SLIDER_MIN,
  AUTO_SLIDER_TRAVEL_MS,
  CameraComparisonSlider,
  autoSliderPosition,
} from "./CameraComparisonSlider";

describe("CameraComparisonSlider", () => {
  it("renders both optical and IR camera images", () => {
    const markup = renderToStaticMarkup(
      <CameraComparisonSlider
        opticalSrc="/camera/haul_truck_optical.png"
        irSrc="/camera/haul_truck_ir.png"
      />,
    );

    expect(markup).toContain("comparison-img-optical");
    expect(markup).toContain("comparison-img-ir");
    expect(markup).toContain("/camera/haul_truck_optical.png");
    expect(markup).toContain("/camera/haul_truck_ir.png");
  });
  it("renders comparison tags and divider handle", () => {
    const markup = renderToStaticMarkup(<CameraComparisonSlider />);

    expect(markup).toContain("REAL LIFE VIEW (OPTICAL FOG)");
    expect(markup).toContain("THERMAL IR CAMERA");
    expect(markup).toContain("slider-divider-line");
    expect(markup).toContain("slider-handle");
    expect(markup).not.toContain("slider-hud-toolbar");
  });
  it("has accessible slider attributes", () => {
    const markup = renderToStaticMarkup(<CameraComparisonSlider />);

    expect(markup).toContain('role="slider"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
    expect(markup).toContain('aria-valuenow="40"');
  });

  it("holds at 40%, travels slowly to 60%, then holds before returning", () => {
    expect(autoSliderPosition(0)).toBe(AUTO_SLIDER_MIN);
    expect(autoSliderPosition(AUTO_SLIDER_HOLD_MS - 1)).toBe(AUTO_SLIDER_MIN);
    expect(autoSliderPosition(AUTO_SLIDER_HOLD_MS + AUTO_SLIDER_TRAVEL_MS)).toBe(AUTO_SLIDER_MAX);
    expect(autoSliderPosition(AUTO_SLIDER_HOLD_MS + AUTO_SLIDER_TRAVEL_MS + 1)).toBe(AUTO_SLIDER_MAX);

    const midpoint = autoSliderPosition(AUTO_SLIDER_HOLD_MS + AUTO_SLIDER_TRAVEL_MS / 2);
    expect(midpoint).toBeGreaterThan(AUTO_SLIDER_MIN);
    expect(midpoint).toBeLessThan(AUTO_SLIDER_MAX);
  });
});
