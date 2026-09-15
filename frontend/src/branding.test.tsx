import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import favicon from "../public/favicon.svg?raw";
import manifest from "../public/manifest.json";
import { LoginPage } from "./auth/LoginPage";
import { DashboardErrorBoundary } from "./components/DashboardErrorBoundary";
import { AppShell } from "./layout/AppShell";

describe("MI Sense branding", () => {
  it("brands the login page and workspace selector", () => {
    const markup = renderToStaticMarkup(
      <LoginPage theme="dark" onThemeChange={vi.fn()} onSelectRole={vi.fn()} />,
    );

    expect(markup).toContain('aria-label="MI Sense"');
    expect(markup).toContain('class="role-login-product">MI Sense</p>');
    expect(markup).toContain('class="brand-mark" aria-hidden="true">MI</span>');
    expect(markup).toContain('aria-label="Choose your MI Sense workspace"');
  });

  it.each(["DRIVER", "SUPERVISOR"] as const)("brands the %s console", (role) => {
    const markup = renderToStaticMarkup(
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

    expect(markup).toContain("<h1>MI Sense</h1>");
    expect(markup).toContain('class="brand-mark" aria-hidden="true">MI</span>');
    expect(markup).toContain(`aria-label="MI Sense ${role.toLowerCase()} home"`);
  });

  it("brands the initial browser title and sharing metadata", () => {
    expect(indexHtml).toContain("<title>MI Sense | Choose console</title>");
    expect(indexHtml).toContain('property="og:title" content="MI Sense"');
    expect(indexHtml).toContain('content="MI Sense vehicle awareness and fleet operations dashboard"');
  });

  it("uses the exact product name for installed app labels", () => {
    expect(manifest.name).toBe("MI Sense");
    expect(manifest.short_name).toBe("MI Sense");
  });

  it("uses the MI monogram in the browser icon", () => {
    expect(favicon).toContain(">MI</text>");
    expect(favicon).not.toContain(">FS</text>");
  });

  it("identifies the product in dashboard error diagnostics", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = new Error("Test render failure");
      const componentStack = "\n at FailedView";
      const boundary = new DashboardErrorBoundary({ children: null, resetKey: "DRIVER" });

      boundary.componentDidCatch(error, { componentStack });

      expect(consoleError).toHaveBeenCalledWith(
        "MI Sense dashboard render failed", error, componentStack,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
