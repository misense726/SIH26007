import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { useTelemetryMock, useSensorSettingsMock } = vi.hoisted(() => ({
  useTelemetryMock: vi.fn(),
  useSensorSettingsMock: vi.fn(),
}));

vi.mock("./state/useTelemetry", () => ({
  useTelemetry: useTelemetryMock,
}));

vi.mock("./settings/useSensorSettings", () => ({
  useSensorSettings: useSensorSettingsMock,
}));

import App from "./App";

describe("App role boundary", () => {
  it("keeps live dashboard hooks unmounted before role selection", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Choose where you are operating");
    expect(useTelemetryMock).not.toHaveBeenCalled();
    expect(useSensorSettingsMock).not.toHaveBeenCalled();
  });
});
