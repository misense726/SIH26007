import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { dashboardViews } from "./dashboardViews";

vi.mock("../simulation/demoMode", () => ({ STATIC_DEMO: true }));

describe("public demo header", () => {
  it.each(dashboardViews)("labels $label as simulated without playback-speed text", ({ value }) => {
    const html = renderToStaticMarkup(
      <AppShell view={value} onViewChange={() => {}} theme="dark" onThemeChange={() => {}}
        connection="CONNECTED" mode="SIMULATED" demoStatus="Demo" demoPaused={false} onDemoPause={() => {}}>
        <div>Demo scene</div>
      </AppShell>,
    );
    expect(html).toContain("SIMULATED");
    expect(html).toContain("Pause demo");
    expect(html).not.toMatch(/2[×x]|playback.speed/i);
    expect(html).not.toContain("Telemetry connected");
  });
});
