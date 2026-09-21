import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  IRCameraCanvas,
  MONOCHROME_FRAGMENT_SHADER,
} from "./IRCameraCanvas";

describe("IRCameraCanvas monochrome output", () => {
  it("outputs equal RGB channels without a thermal palette", () => {
    expect(MONOCHROME_FRAGMENT_SHADER).toContain("vec4(vec3(luma), 1.0)");
    expect(MONOCHROME_FRAGMENT_SHADER).toContain("0.2126, 0.7152, 0.0722");
    expect(MONOCHROME_FRAGMENT_SHADER).not.toContain("thermal(");
    expect(MONOCHROME_FRAGMENT_SHADER).not.toContain("u_time");
  });

  it("uses neutral monochrome labels and styling", () => {
    const markup = renderToStaticMarkup(
      <IRCameraCanvas
        src="/camera/haul_truck_ir.png"
        alt="Monochrome forward camera feed"
      />,
    );

    expect(markup).toContain("monochrome-camera-canvas");
    expect(markup).toContain("Monochrome forward camera feed");
    expect(markup).not.toMatch(/Thermal|GPU|false color/i);
  });
});
