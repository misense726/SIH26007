import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import type { TripRecord } from "../types";
import { HaulCycleChart, HaulEfficiencyPanel } from "./HaulEfficiencyPanel";
import {
  DISPLAYED_TRIP_COUNT,
  EFFICIENCY_REFRESH_MS,
  selectEfficiencyTrips,
  summarizeTrips,
  toEfficiencyTrip,
} from "./haulEfficiency";
import { createSupervisorViewModel } from "./supervisorViewModel";

function apiTrip(index: number, vehicleId = "DUMPER_01"): TripRecord {
  const payload = 81 + index * 1.1;
  const distance = 4.72 + index * 0.013;
  const fuel = 43.6 + index * 0.29 + index * index * 0.003;
  return {
    source: "SIMULATED",
    trip_id: `${vehicleId}-TRIP-${index + 1}`,
    vehicle_id: vehicleId,
    callsign: vehicleId,
    pickup_node: "PIT_FLOOR",
    dump_node: "CRUSHER",
    payload_tonnes: payload,
    start_time_ms: 1_700_000_000_000 + index * 1_800_000,
    end_time_ms: 1_700_001_500_000 + index * 1_800_000,
    cycle_duration_s: 1_500 + index * 7,
    loading_wait_s: 120 + index,
    loaded_travel_s: 540 + index * 2,
    dumping_wait_s: 70,
    empty_return_s: 610 + index * 2,
    idle_s: 160 + index * 2,
    distance_km: distance,
    avg_speed_kmh: 24 + index * 0.2,
    route_deviations_count: 0,
    route_compliance_pct: 100,
    fuel_litres_est: fuel,
  };
}

const visibleTrips = selectEfficiencyTrips(
  Array.from({ length: DISPLAYED_TRIP_COUNT }, (_, index) => apiTrip(index)),
  "DUMPER_01",
  DISPLAYED_TRIP_COUNT,
);

describe("haul efficiency data", () => {
  it("shows a default window of 15 completed hauls with distinct displayed values", () => {
    expect(DISPLAYED_TRIP_COUNT).toBe(15);
    expect(visibleTrips).toHaveLength(15);
    expect(new Set(visibleTrips.map((trip) => trip.payloadT.toFixed(1))).size).toBe(15);
    expect(new Set(visibleTrips.map((trip) => trip.efficiency.toFixed(2))).size).toBe(15);
  });

  it("filters by selected truck, removes duplicate IDs and keeps chronological order", () => {
    const records = [apiTrip(3), apiTrip(1, "DUMPER_02"), apiTrip(0), apiTrip(3)];
    const selected = selectEfficiencyTrips(records, "DUMPER_01", 15);
    expect(selected.map((trip) => trip.id)).toEqual(["DUMPER_01-TRIP-1", "DUMPER_01-TRIP-4"]);
    expect(selected.map((trip) => trip.number)).toEqual([1, 2]);
  });

  it("rejects invalid payload, fuel and distance rather than drawing fake points", () => {
    expect(toEfficiencyTrip({ ...apiTrip(0), fuel_litres_est: 0 }, 1)).toBeNull();
    expect(toEfficiencyTrip({ ...apiTrip(0), payload_tonnes: Number.NaN }, 1)).toBeNull();
    expect(toEfficiencyTrip({ ...apiTrip(0), distance_km: -1 }, 1)).toBeNull();
  });

  it("uses fuel-weighted transport efficiency for the summary", () => {
    const summary = summarizeTrips(visibleTrips);
    const expected = visibleTrips.reduce((sum, trip) => sum + trip.payloadT * trip.distanceKm, 0)
      / visibleTrips.reduce((sum, trip) => sum + trip.fuelL, 0);
    expect(summary.efficiency).toBeCloseTo(expected);
    expect(summary.count).toBe(15);
  });

  it("retains the 30-second refresh cadence", () => {
    expect(EFFICIENCY_REFRESH_MS).toBe(30_000);
  });
});

describe("HaulEfficiencyPanel", () => {
  const model = createSupervisorViewModel({
    ...defaultWorldState,
    vehicles: [
      { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_01" },
      { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_02" },
      { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_03" },
    ],
  });

  it("renders a single truck filter row and honest simulated provenance", () => {
    const markup = renderToStaticMarkup(<HaulEfficiencyPanel vehicles={model.vehicles} world={defaultWorldState} />);
    expect(markup).toContain("id=\"efficiency-vehicle-select\"");
    expect(markup).toContain("id=\"efficiency-window-select\"");
    expect(markup).toContain("Last 15 hauls");
    expect(markup).toContain("SIMULATED");
    expect(markup).toContain("estimated fuel");
    expect(markup).not.toMatch(/model payload|best efficiency curve|sweet.?spot/i);
  });

  it("renders a static line, payload bars and 15 keyboard-accessible hit targets", () => {
    const markup = renderToStaticMarkup(
      <HaulCycleChart trips={visibleTrips} vehicleId="DUMPER_01" activeId={null} onInspect={() => undefined} />,
    );
    expect(markup).toContain("haul-efficiency-line");
    expect(markup.match(/class=\"haul-payload-bar\"/g)).toHaveLength(15);
    expect(markup.match(/class=\"haul-hit-target\"/g)).toHaveLength(15);
    expect(markup).not.toMatch(/pulse|animation|cursor.*latest/i);
  });

  it("provides a matching records table without hiding chart values behind hover", () => {
    const chartMarkup = renderToStaticMarkup(
      <HaulCycleChart trips={visibleTrips} vehicleId="DUMPER_01" activeId={visibleTrips[4].id} onInspect={() => undefined} />,
    );
    expect(chartMarkup).toContain("Haul 05");
    expect(chartMarkup).toContain(`${visibleTrips[4].payloadT.toFixed(1)} t payload`);
    expect(chartMarkup).toContain(`${visibleTrips[4].fuelL.toFixed(1)} L estimated fuel`);
  });

  it("handles an empty fleet without placeholder efficiency values", () => {
    const markup = renderToStaticMarkup(<HaulEfficiencyPanel vehicles={[]} world={defaultWorldState} />);
    expect(markup).toContain("No fleet vehicles online");
    expect(markup).not.toContain("0.00 t·km/L");
  });
});
