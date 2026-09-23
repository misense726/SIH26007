import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import { defaultWorldState } from "../state/defaultState";

vi.mock("../driver/DriverDashboard", () => ({
  DriverDashboard: () => <p>Live driver view</p>,
}));
vi.mock("../spatial/SpatialDashboard", () => ({
  SpatialDashboard: () => <p>Live spatial view</p>,
}));
vi.mock("../supervisor/SupervisorDashboard", () => ({
  SupervisorDashboard: () => <p>Live supervisor view</p>,
}));
vi.mock("../settings/SensorSettingsPage", () => ({
  SensorSettingsPage: () => <p>Live calibration view</p>,
}));

import { DashboardViewRouter } from "./DashboardViewRouter";

describe("DashboardViewRouter module loading", () => {
  it("renders the driver view without waiting for a separate module request", () => {
    const markup = renderToStaticMarkup(
      <DashboardViewRouter
        view="DRIVER"
        world={defaultWorldState}
        connection="CONNECTED"
        awarenessMode="CAMERA"
        onAwarenessModeChange={vi.fn()}
        sensorSettings={defaultSensorSettings()}
        settingsConnection="SAVED"
        settingsMessage={null}
        onSensorChange={vi.fn()}
        onSensorSave={vi.fn()}
        onZeroImu={vi.fn()}
      />,
    );

    expect(markup).toContain("Live driver view");
    expect(markup).not.toContain("Loading console");
  });
});
