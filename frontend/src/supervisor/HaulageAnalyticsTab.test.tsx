import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HaulageAnalyticsTab } from "./HaulageAnalyticsTab";

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
});
