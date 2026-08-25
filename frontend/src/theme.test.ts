import { describe, expect, it } from "vitest";
import { oppositeTheme, resolveTheme } from "./theme";

describe("theme preference", () => {
  it("uses a saved theme before the system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to the system preference", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("unknown", false)).toBe("light");
  });

  it("switches between light and dark", () => {
    expect(oppositeTheme("dark")).toBe("light");
    expect(oppositeTheme("light")).toBe("dark");
  });
});
