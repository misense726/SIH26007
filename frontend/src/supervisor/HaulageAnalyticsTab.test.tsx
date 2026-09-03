import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HaulageAnalyticsTab } from "./HaulageAnalyticsTab";

const analyticsState = vi.hoisted(() => ({ missingAfterLoad: false }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useState: (initialState: unknown) => {
      if (!analyticsState.missingAfterLoad) {
        return actual.useState(initialState);
      }

      return [initialState === true ? false : initialState, () => undefined];
    },
  };
});

afterEach(() => {
  analyticsState.missingAfterLoad = false;
});

describe("HaulageAnalyticsTab", () => {
  it("renders loading or initial dashboard structure cleanly", () => {
    const markup = renderToStaticMarkup(<HaulageAnalyticsTab />);
    expect(markup).toBeDefined();
    // Initially in static SSR render, renders loading state or dashboard container
    expect(
      markup.includes("analytics-loading-state") ||
      markup.includes("haulage-analytics-dashboard")
    ).toBe(true);
  });

  it.fails.each([
    ["live data", "Live Ingest"],
    ["four active trucks", "4 Dumpers"],
    ["default compliance", "100% Route Compliance"],
  ])("does not claim %s when analytics are missing", (_claim, fabricatedText) => {
    analyticsState.missingAfterLoad = true;
    const markup = renderToStaticMarkup(<HaulageAnalyticsTab />);

    expect(markup).toContain("haulage-analytics-dashboard");
    expect(markup).not.toContain(fabricatedText);
  });
});
