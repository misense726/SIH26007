import { describe, expect, it } from "vitest";
import { defaultWorldState } from "./defaultState";
import { isWorldStateSnapshot } from "./worldStateSnapshot";

function snapshotCopy(): Record<string, unknown> {
  return structuredClone(defaultWorldState) as unknown as Record<string, unknown>;
}

describe("world state snapshot validation", () => {
  it("accepts the complete world-state contract", () => {
    expect(isWorldStateSnapshot(snapshotCopy())).toBe(true);
  });

  it("rejects snapshots with missing render-critical state", () => {
    const snapshot = snapshotCopy();
    delete snapshot.safe_corridor;
    expect(isWorldStateSnapshot(snapshot)).toBe(false);
  });

  it("rejects malformed collections and unsupported modes", () => {
    const malformedRanges = snapshotCopy();
    malformedRanges.ranges = {};
    expect(isWorldStateSnapshot(malformedRanges)).toBe(false);

    const unsupportedMode = snapshotCopy();
    unsupportedMode.mode = "UNKNOWN";
    expect(isWorldStateSnapshot(unsupportedMode)).toBe(false);

    const malformedV2x = snapshotCopy();
    malformedV2x.v2x = { enabled: true };
    expect(isWorldStateSnapshot(malformedV2x)).toBe(false);
  });

  it("rejects map features without renderable points", () => {
    const snapshot = snapshotCopy();
    snapshot.reference_map = {
      map_id: "HAUL_ROAD",
      name: "Haul road",
      version: 1,
      created_at_ms: 1,
      coordinate_frame: "LOCAL_CARTESIAN_METRES",
      source: "MANUAL",
      features: [
        {
          feature_id: "START_01",
          feature_type: "START",
          geometry_type: "POINT",
          points: [],
          label: "Start",
          properties: {},
        },
      ],
    };

    expect(isWorldStateSnapshot(snapshot)).toBe(false);
  });

  it("rejects malformed nested V2X peer values", () => {
    const snapshot = snapshotCopy();
    const v2x = structuredClone(defaultWorldState.v2x) as unknown as Record<
      string,
      unknown
    >;
    v2x.active_peers = [
      {
        vehicle_id: "DUMPER_02",
        last_seen_ms: 1,
        x_m: 1,
        y_m: 2,
        distance_m: 3,
        speed_mps: "fast",
        heading_deg: 90,
        emergency_state: "SAFE",
        rssi_dbm: -60,
        link_status: "GOOD",
      },
    ];
    snapshot.v2x = v2x;

    expect(isWorldStateSnapshot(snapshot)).toBe(false);
  });
});
