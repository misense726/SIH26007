import { describe, expect, it } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import type { SensorHealth, WorldState } from "../types";
import { createSupervisorViewModel } from "./supervisorViewModel";

const healthySensors: SensorHealth[] = [
  "front_scanner",
  "front_fixed",
  "rear_scanner",
  "left_side",
  "right_side",
].map((sensorId) => ({
  sensor_id: sensorId,
  status: "HEALTHY",
  last_update_ms: 2_000,
  confidence: 0.98,
  detail: null,
}));

function worldWithHealthyPrimary(): WorldState {
  return {
    ...defaultWorldState,
    generated_at_ms: 2_000,
    vehicles: [{ ...defaultWorldState.vehicles[0], timestamp_ms: 1_900 }],
    sensor_health: healthySensors,
    environment: {
      ...defaultWorldState.environment,
      timestamp_ms: 2_000,
      visibility_score: 0.9,
      visibility_state: "GOOD",
    },
    emergency: { ...defaultWorldState.emergency, confidence: 0.95 },
  };
}

describe("createSupervisorViewModel", () => {
  it("keeps every canonical vehicle and merges matching V2X peers once", () => {
    const world = worldWithHealthyPrimary();
    world.vehicles = [
      world.vehicles[0],
      {
        ...world.vehicles[0],
        vehicle_id: "DUMPER_02",
        x_m: 22,
        position_confidence: 0.83,
      },
    ];
    world.v2x = {
      ...world.v2x!,
      timestamp_ms: 2_000,
      active_peers: [
        {
          vehicle_id: "DUMPER_02",
          last_seen_ms: 1_980,
          x_m: 21,
          y_m: 8,
          distance_m: 24,
          speed_mps: 3,
          heading_deg: 90,
          emergency_state: "SAFE",
          rssi_dbm: -61,
          link_status: "GOOD",
        },
        {
          vehicle_id: "DUMPER_03",
          last_seen_ms: 1_970,
          x_m: -12,
          y_m: 19,
          distance_m: 31,
          speed_mps: 2,
          heading_deg: 180,
          emergency_state: "SAFE",
          rssi_dbm: -70,
          link_status: "EXCELLENT",
        },
      ],
    };

    const model = createSupervisorViewModel(world);

    expect(model.vehicles.map((vehicle) => vehicle.vehicleId).sort()).toEqual([
      "DUMPER_01",
      "DUMPER_02",
      "DUMPER_03",
    ]);
    expect(model.vehicles.find((vehicle) => vehicle.vehicleId === "DUMPER_02")).toMatchObject({
      sourceLabel: "Vehicle + V2X",
      xM: 22,
      linkStatus: "GOOD",
      distanceM: 24,
    });
    expect(model.counts).toMatchObject({ total: 3, online: 3, lost: 0 });
  });

  it("separates live issues from historical informational events", () => {
    const world = worldWithHealthyPrimary();
    world.v2x = {
      ...world.v2x!,
      timestamp_ms: 2_000,
      active_peers: [
        {
          vehicle_id: "HAULER_09",
          last_seen_ms: 500,
          x_m: 4,
          y_m: 6,
          distance_m: 12,
          speed_mps: 0,
          heading_deg: 0,
          emergency_state: "SAFE",
          rssi_dbm: -99,
          link_status: "LOST",
        },
      ],
    };
    world.alerts = [
      {
        event_id: "clear-1",
        timestamp_ms: 1_800,
        severity: "INFO",
        title: "Safety condition cleared",
        detail: "Vehicle returned to a safe state.",
        vehicle_id: "DUMPER_01",
      },
    ];

    const model = createSupervisorViewModel(world);

    expect(model.counts.lost).toBe(1);
    expect(model.issues).toEqual([
      expect.objectContaining({ kind: "CONNECTIVITY", title: "Vehicle contact lost" }),
    ]);
    expect(model.history).toHaveLength(1);
    expect(model.history[0].severity).toBe("INFO");
  });

  it("marks primary sensor and visibility exceptions without hiding primary telemetry", () => {
    const world = worldWithHealthyPrimary();
    world.sensor_health = healthySensors.map((sensor, index) =>
      index === 0 ? { ...sensor, status: "OFFLINE", confidence: 0 } : sensor,
    );
    world.environment = {
      ...world.environment,
      visibility_score: 0.24,
      visibility_state: "VERY_LOW",
    };

    const model = createSupervisorViewModel(world);

    expect(model.counts.attention).toBe(1);
    expect(model.issues.map((issue) => issue.kind)).toEqual(["VISIBILITY", "SENSOR"]);
    expect(model.primary).toMatchObject({
      visibilityPercent: 24,
      sensorSummary: { healthy: 4, total: 5 },
    });
  });

  it("keeps a directly connected truck in the fleet while its position is unknown", () => {
    const world = worldWithHealthyPrimary();
    world.vehicle_telemetry = [{
      vehicle_id: "DUMPER_02",
      received_at_ms: 1_990,
      online: true,
      gps: { fix: false, lat: null, lon: null, alt_m: null, speed_mps: null, sats: 0, hdop: null, age: null, bytes: 0 },
      load: null,
    }];

    const model = createSupervisorViewModel(world);

    expect(model.counts).toMatchObject({ total: 2, online: 2, unknown: 1 });
    expect(model.vehicles.find((vehicle) => vehicle.vehicleId === "DUMPER_02")).toMatchObject({
      sourceLabel: "Direct Wi-Fi telemetry",
      hasPosition: false,
      tone: "unknown",
    });
  });

  it("keeps a zero-confidence LIVE pose off the map", () => {
    const world = worldWithHealthyPrimary();
    world.mode = "LIVE";
    world.vehicles = [{
      ...world.vehicles[0],
      mode: "LIVE",
      x_m: 0,
      y_m: 0,
      position_confidence: 0,
    }];

    const model = createSupervisorViewModel(world);

    expect(model.primary?.vehicle).toMatchObject({
      hasPosition: false,
      positionConfidence: 0,
    });
  });
});
