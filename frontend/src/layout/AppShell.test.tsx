import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardRole } from "../auth/roleSession";
import { AppShell } from "./AppShell";

function renderShell(role: DashboardRole) {
  return renderToStaticMarkup(
    <AppShell
      role={role}
      view={role}
      onViewChange={vi.fn()}
      onLogout={vi.fn()}
      theme="dark"
      onThemeChange={vi.fn()}
      connection="DISCONNECTED"
      mode={null}
    >
      <p>Dashboard content</p>
    </AppShell>,
  );
}

describe("AppShell role navigation", () => {
  it("shows workspace navigation to the Driver", () => {
    const markup = renderShell("DRIVER");

    expect(markup).toContain("Driver console");
    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain("Exit console");
  });

  it("keeps the Supervisor in the Fleet workspace", () => {
    const markup = renderShell("SUPERVISOR");

    expect(markup).toContain("Supervisor console");
    expect(markup).not.toContain('aria-label="Primary navigation"');
  });
});
