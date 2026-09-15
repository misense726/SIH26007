import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

describe("LoginPage", () => {
  it("offers the two demo workspaces without credential fields", () => {
    const markup = renderToStaticMarkup(
      <LoginPage theme="dark" onThemeChange={vi.fn()} onSelectRole={vi.fn()} />,
    );

    expect(markup).toContain("Continue as Driver");
    expect(markup).toContain("Continue as Supervisor");
    expect(markup).toContain("Choose where you are operating");
    expect(markup).not.toContain("Console handoff");
    expect(markup).not.toContain("Open the in-cab awareness workspace");
    expect(markup).not.toContain("Demo role selection only");
    expect(markup).not.toContain("<input");
  });
});
