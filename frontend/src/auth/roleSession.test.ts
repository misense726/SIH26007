import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRole,
  parseDashboardRole,
  readInitialRole,
  ROLE_SESSION_KEY,
  saveRole,
} from "./roleSession";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo role session", () => {
  it("accepts only known dashboard roles", () => {
    expect(parseDashboardRole("DRIVER")).toBe("DRIVER");
    expect(parseDashboardRole("SUPERVISOR")).toBe("SUPERVISOR");
    expect(parseDashboardRole("driver")).toBeNull();
    expect(parseDashboardRole("ADMIN")).toBeNull();
    expect(parseDashboardRole(null)).toBeNull();
  });

  it("reads a valid role from session storage", () => {
    const getItem = vi.fn(() => "SUPERVISOR");
    vi.stubGlobal("window", { sessionStorage: { getItem } });

    expect(readInitialRole()).toBe("SUPERVISOR");
    expect(getItem).toHaveBeenCalledWith(ROLE_SESSION_KEY);
  });

  it("fails closed for invalid or unavailable storage", () => {
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => "UNKNOWN" },
    });
    expect(readInitialRole()).toBeNull();

    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readInitialRole()).toBeNull();
  });

  it("saves and clears the selected role", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal("window", {
      sessionStorage: { setItem, removeItem },
    });

    saveRole("DRIVER");
    clearRole();

    expect(setItem).toHaveBeenCalledWith(ROLE_SESSION_KEY, "DRIVER");
    expect(removeItem).toHaveBeenCalledWith(ROLE_SESSION_KEY);
  });
});
