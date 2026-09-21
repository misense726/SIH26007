import { describe, expect, it, vi } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import type { VehiclePose, WorldState } from "../types";
import { buildLidarFrame } from "./lidarFrame";

const vehicle: VehiclePose = {
  ...defaultWorldState.vehicles[0],
  timestamp_ms: 1_000,
  x_m: 10,
  y_m: 20,
  heading_deg: 0,
  position_confidence: 1,
};

function world(overrides: Partial<WorldState> = {}): WorldState {
  return {
    ...defaultWorldState,
    generated_at_ms: 1_000,
    vehicles: [vehicle],
    spatial_points: [
      {
        x_m: 12,
        y_m: 32,
        height_hint_m: 1.2,
        source_sensor_id: "front_scanner",
        quality: 0.95,
        timestamp_ms: 1_000,
      },
    ],
    sensor_health: [
      {
        sensor_id: "front_scanner",
        status: "HEALTHY",
        last_update_ms: 1_000,
        confidence: 1,
        detail: null,
      },
    ],
    reference_map: {
      map_id: "lidar-test",
      name: "LiDAR test",
      version: 1,
      created_at_ms: 1_000,
      coordinate_frame: "LOCAL_CARTESIAN_METRES",
      source: "test",
      features: [
        {
          feature_id: "road",
          feature_type: "ROAD",
          geometry_type: "POLYGON",
          points: [
            { x_m: 6, y_m: 10 },
            { x_m: 14, y_m: 10 },
            { x_m: 14, y_m: 60 },
            { x_m: 6, y_m: 60 },
          ],
          label: "Road",
          properties: {},
        },
      ],
    },
    ...overrides,
  };
}

describe("buildLidarFrame", () => {
  it("is deterministic and does not use random data", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("randomness is not allowed");
    });
    const first = buildLidarFrame(world(), vehicle);
    const second = buildLidarFrame(world(), vehicle);
    random.mockRestore();

    expect(Array.from(first.roadPositions)).toEqual(Array.from(second.roadPositions));
    expect(Array.from(first.returnPositions)).toEqual(
      Array.from(second.returnPositions),
    );
    expect(first.paths).toEqual(second.paths);
    expect(first.entities).toEqual(second.entities);
  });

  it("uses the vehicle coordinate frame and includes returns beyond four metres", () => {
    const frame = buildLidarFrame(world(), vehicle);

    expect(frame.returnCount).toBe(1);
    expect(
      Array.from(frame.returnPositions).map((v) => Math.round(v * 100) / 100),
    ).toEqual([2, 1.2, -12]);
    expect(frame.roadPointCount).toBeGreaterThan(0);
    expect(frame.paths).toHaveLength(1);
  });

  it("rotates world points with the vehicle heading", () => {
    const eastFacing = { ...vehicle, heading_deg: 90 };
    const frame = buildLidarFrame(world({ vehicles: [eastFacing] }), eastFacing);

    expect(
      Array.from(frame.returnPositions).map((v) => Math.round(v * 100) / 100),
    ).toEqual([-12, 1.2, -2]);
  });

  it("creates stable tracked entities for peers, live objects, and obstacles", () => {
    const frame = buildLidarFrame(
      world({
        vehicles: [
          vehicle,
          {
            ...vehicle,
            vehicle_id: "DUMPER_02",
            x_m: 13,
            y_m: 30,
            heading_deg: 15,
          },
        ],
        live_objects: [
          {
            timestamp_ms: 1_000,
            object_id: "worker-1",
            x_m: 8,
            y_m: 26,
            object_type: "person",
            confidence: 0.9,
            source: "test",
            mode: "SIMULATED",
          },
        ],
        haul_route: {
          origin: "Mine",
          destination: "Crusher",
          phase: "OBSTACLE",
          distance_m: 10,
          total_distance_m: 100,
          remaining_m: 90,
          elapsed_s: 10,
          obstacle_detected: true,
          obstacle_distance_m: 4,
          obstacle: { x_m: 11, y_m: 24 },
          obstacle_radius_m: 0.5,
          next_instruction: "Rock ahead",
        },
      }),
      vehicle,
    );

    expect(frame.entities.map((entity) => entity.id)).toEqual([
      "vehicle:DUMPER_02",
      "object:worker-1",
      "haul-obstacle",
    ]);
    for (const entity of frame.entities) {
      expect([...entity.position, ...entity.size, entity.yawRad].every(Number.isFinite)).toBe(true);
    }
  });

  it("rejects stale and unhealthy returns", () => {
    const stale = world({
      generated_at_ms: 20_000,
      sensor_health: [
        {
          sensor_id: "front_scanner",
          status: "OFFLINE",
          last_update_ms: 20_000,
          confidence: 0,
          detail: null,
        },
      ],
    });

    expect(buildLidarFrame(stale, vehicle).returnCount).toBe(0);
  });
});
