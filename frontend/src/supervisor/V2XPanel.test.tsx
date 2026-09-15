import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import type { V2XState } from "../types";
import { SupervisorDashboard } from "./SupervisorDashboard";
import { V2XPanel } from "./V2XPanel";

vi.mock("leaflet", () => ({
  default: {
    map: vi.fn(() => ({
      setView: vi.fn(),
      panTo: vi.fn(),
      remove: vi.fn(),
      on: vi.fn(),
      removeLayer: vi.fn(),
      invalidateSize: vi.fn(),
    })),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), bringToBack: vi.fn() })),
    marker: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      setLatLng: vi.fn(),
      setIcon: vi.fn(),
      bindPopup: vi.fn(),
      on: vi.fn(),
    })),
    divIcon: vi.fn(() => ({})),
    polyline: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    layerGroup: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), addLayer: vi.fn() })),
    control: { zoom: vi.fn(() => ({ addTo: vi.fn() })), scale: vi.fn(() => ({ addTo: vi.fn() })) },
  },
}));

describe("V2XPanel", () => {
  const mockV2XState: V2XState = {
    timestamp_ms: 1700000000000,
    enabled: true,
    node_id: "DUMPER_01",
    protocol_version: "1.0-DSRC-SIM",
    tx_packet_count: 42,
    rx_packet_count: 88,
    channel_frequency_mhz: 5890,
    active_peers: [
      {
        vehicle_id: "DUMPER_02",
        last_seen_ms: 1700000000000,
        x_m: 15.2,
        y_m: 24.8,
        distance_m: 29.1,
        speed_mps: 4.0,
        heading_deg: 92.4,
        emergency_state: "SAFE",
        rssi_dbm: -58,
        link_status: "EXCELLENT",
      },
      {
        vehicle_id: "HAULER_09",
        last_seen_ms: 1700000000000,
        x_m: -30.0,
        y_m: 40.0,
        distance_m: 50.0,
        speed_mps: 0.0,
        heading_deg: 180.0,
        emergency_state: "EMERGENCY_STOP",
        rssi_dbm: -88,
        link_status: "DEGRADED",
      },
    ],
    infrastructure_nodes: [
      {
        rsu_id: "RSU_NORTH",
        name: "North Pit Haul RSU",
        x_m: 20.0,
        y_m: 45.0,
        status: "ACTIVE",
        coverage_radius_m: 200.0,
        active_advisories_count: 1,
      },
    ],
    active_advisories: [
      {
        message_id: "ADV-001",
        timestamp_ms: 1700000000000,
        rsu_id: "RSU_NORTH",
        rsu_name: "North Pit Haul RSU",
        advisory_type: "FOG_WARNING",
        title: "Heavy Fog on Ramp",
        detail: "Visibility under 15m. Reduce speed.",
        speed_limit_kmh: 20,
        expires_at_ms: null,
        zone_x_m: 20.0,
        zone_y_m: 45.0,
        zone_radius_m: 80.0,
      },
    ],
    recent_messages: [
      {
        message_id: "MSG-001",
        timestamp_ms: 1700000000000,
        msg_type: "V2V_BSM",
        source_id: "DUMPER_01",
        target_id: "BROADCAST",
        summary: "BSM broadcast from DUMPER_01",
      },
      {
        message_id: "MSG-002",
        timestamp_ms: 1700000001000,
        msg_type: "V2V_PROXIMITY_ALERT",
        source_id: "DUMPER_01",
        target_id: "DUMPER_02",
        summary: "Proximity alert: 15m separation",
      },
    ],
  };

  it("renders offline banner when v2x telemetry is undefined", () => {
    const markup = renderToStaticMarkup(<V2XPanel />);
    expect(markup).toContain("NETWORK SIMULATION");
    expect(markup).toContain("Simulation data unavailable.");
  });

  it("renders standby message when v2x is disabled", () => {
    const disabledState: V2XState = { ...mockV2XState, enabled: false };
    const markup = renderToStaticMarkup(<V2XPanel v2x={disabledState} />);
    expect(markup).toContain("NETWORK SIMULATION");
    expect(markup).toContain("Coordination network paused.");
  });

  it("shows coordination health without repeating fleet motion and safety data", () => {
    const markup = renderToStaticMarkup(<V2XPanel v2x={mockV2XState} />);
    expect(markup).toContain("Sent: <strong>42</strong>");
    expect(markup).toContain("Received: <strong>88</strong>");
    expect(markup).toContain('id="v2x-tab-links"');
    expect(markup).toContain('aria-selected="true" aria-controls="v2x-tabpanel-links" tabindex="0"');
    expect(markup).toContain('aria-selected="false" aria-controls="v2x-tabpanel-advisories" tabindex="-1"');
    expect(markup).not.toContain("GHz DSRC");
    expect(markup).not.toContain("dBm");
    expect(markup).toContain("DUMPER_02");
    expect(markup).toContain("29.1 m");
    expect(markup).toContain("EXCELLENT");
    expect(markup).toContain("HAULER_09");
    expect(markup).toContain("DEGRADED");
    expect(markup).not.toContain("14.4 km/h");
    expect(markup).not.toContain("92°");
    expect(markup).not.toContain("EMERGENCY STOP");
  });

  it("renders empty peer list when no peers are in range", () => {
    const emptyPeersState: V2XState = { ...mockV2XState, active_peers: [] };
    const markup = renderToStaticMarkup(<V2XPanel v2x={emptyPeersState} />);
    expect(markup).toContain("No simulated coordination links.");
  });

  it("renders an exception-first supervisor overview", () => {
    const world = {
      ...defaultWorldState,
      v2x: mockV2XState,
      alerts: [
        {
          event_id: "ALERT-001",
          timestamp_ms: 1_700_000_000_000,
          severity: "WARNING" as const,
          title: "Low visibility",
          detail: "Visibility is below the preferred operating range.",
          vehicle_id: "DUMPER_02",
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <SupervisorDashboard world={world} connection="CONNECTED" />,
    );
    expect(markup).toContain("Fleet command");
    expect(markup).toContain("What needs action");
    expect(markup).toContain("DUMPER_02");
    expect(markup).toContain("HAULER_09");
    expect(markup).toContain("EMERGENCY STOP");
    expect(markup).toContain("Low visibility");
    expect(markup).not.toContain("Coordination network");
  });

  it("honors the designated primary vehicle and does not fabricate one", () => {
    const designatedWorld = {
      ...defaultWorldState,
      primary_vehicle_id: "DUMPER_02",
      vehicles: [
        { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_01" },
        { ...defaultWorldState.vehicles[0], vehicle_id: "DUMPER_02" },
      ],
    };
    const designatedMarkup = renderToStaticMarkup(
      <SupervisorDashboard world={designatedWorld} connection="CONNECTED" />,
    );
    expect(designatedMarkup).toContain("Focused on DUMPER_02");
    expect(designatedMarkup).toContain("Primary vehicle");

    const emptyMarkup = renderToStaticMarkup(
      <SupervisorDashboard
        world={{ ...defaultWorldState, vehicles: [], v2x: undefined }}
        connection="CONNECTED"
      />,
    );
    expect(emptyMarkup).toContain("No vehicle telemetry");
    expect(emptyMarkup).not.toContain("DUMPER_01 [PRIMARY]");
  });
});
