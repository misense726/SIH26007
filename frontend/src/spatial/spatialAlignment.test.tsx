import { describe, expect, it, vi } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import { defaultSensorSettings } from "../settings/sensorSettingsApi";
import type { WorldState } from "../types";
import { buildLidarFrame, type SpatialPreview } from "./mappingFrame";

const sensors = defaultSensorSettings().sensors;
const preview: SpatialPreview = { source: "SIMULATED", coordinate_frame: "VEHICLE_X_RIGHT_Y_FORWARD_Z_UP",
  points: [-5, 8, 0, 5, 12, 2], entities: [] };
function worldWithReturn(mode: WorldState["mode"]): WorldState {
  return {
    ...defaultWorldState, mode, generated_at_ms: 1000,
    vehicles: [{ ...defaultWorldState.vehicles[0], mode }],
    spatial_points: [{ x_m: -1.36, y_m: 0, height_hint_m: 0.8,
      timestamp_ms: 1000, source_sensor_id: "left_side", quality: 1 }],
    sensor_health: [{ sensor_id: "left_side", status: "HEALTHY",
      last_update_ms: 1000, confidence: 1, detail: null }],
  };
}
const frame = (world: WorldState, connected = true) => buildLidarFrame(world, world.vehicles[0], sensors, connected, preview);

describe("Point-cloud sources and alignment", () => {
  it.each(["LIVE", "SIMULATED", "REPLAY"] as const)("keeps %s points at measured XY despite visual IMU and height hints", mode => {
    const world = worldWithReturn(mode);
    const baseline = frame(world);
    expect(Array.from(baseline.returnPositions)).toEqual([expect.closeTo(-1.36), expect.closeTo(0.04), -0]);
    expect(baseline.measuredCount).toBe(1);
    expect(baseline.source).toBe("MEASURED");
    expect(frame({ ...world, motion: { ...world.motion, imu_heading_deg: 90 } }).returnPositions).toEqual(baseline.returnPositions);
    expect(baseline.egoSize[0]).toBeLessThanOrEqual(0.72);
  });

  it("transforms rotated world observations once using vehicle heading", () => {
    const world = worldWithReturn("LIVE");
    world.vehicles[0] = { ...world.vehicles[0], x_m: 10, y_m: 20, heading_deg: 90 };
    world.spatial_points[0] = { ...world.spatial_points[0], x_m: 10, y_m: 21.36 };
    expect(Array.from(frame(world).returnPositions)).toEqual([expect.closeTo(-1.36), expect.closeTo(0.04), expect.closeTo(0)]);
  });

  it.each(["LIVE", "SIMULATED", "REPLAY"] as const)("retains points near all calibrated sensor limits in %s", mode => {
    const world = worldWithReturn(mode);
    world.sensor_health = sensors.map(sensor => ({ sensor_id: sensor.sensor_id, status: "HEALTHY", last_update_ms: 1000, confidence: 1, detail: null }));
    world.spatial_points = sensors.map(sensor => {
      const yaw = sensor.display_pose.yaw_deg * Math.PI / 180;
      return { timestamp_ms: 1000, source_sensor_id: sensor.sensor_id, quality: 1, height_hint_m: 4,
        x_m: sensor.display_pose.x_m + Math.sin(yaw) * (sensor.visual_range_m - 0.01),
        y_m: sensor.display_pose.y_m + Math.cos(yaw) * (sensor.visual_range_m - 0.01) };
    });
    expect(frame(world).measuredCount).toBe(5);
  });

  it("switches missing, stale and disconnected observations to a labelled preview", () => {
    const world = worldWithReturn("LIVE");
    for (const result of [frame(world, false), frame({ ...world, spatial_points: [] }),
      frame({ ...world, generated_at_ms: 20000 }),
      frame({ ...world, sensor_health: [{ ...world.sensor_health[0], status: "OFFLINE" }] })]) {
      expect(result.source).toBe("SIMULATED_PREVIEW");
      expect(result.measuredCount).toBe(0);
      expect(result.returnCount).toBe(2);
    }
    expect(frame(world).source).toBe("MEASURED");
  });

  it("never inserts preview data into recorded playback or mutates the world", () => {
    const world = { ...worldWithReturn("REPLAY"), spatial_points: [] };
    const original = structuredClone(world);
    expect(frame(world).source).toBe("WAITING");
    expect(frame(world).returnCount).toBe(0);
    expect(world).toEqual(original);
  });

  it("renders backend map and fleet motion only for the simulated source", () => {
    const world = worldWithReturn("SIMULATED");
    world.vehicles[0].position_confidence = 1;
    world.vehicles.push({ ...world.vehicles[0], vehicle_id: "PEER", x_m: 3, y_m: 10 });
    world.reference_map = { map_id: "test", name: "Test", version: 1, created_at_ms: 0,
      coordinate_frame: "LOCAL_CARTESIAN_METRES", source: "test", features: [{ feature_id: "road",
        feature_type: "ROAD", geometry_type: "POLYGON", label: "Road", properties: {},
        points: [{ x_m: -4, y_m: -5 }, { x_m: 4, y_m: -5 }, { x_m: 4, y_m: 30 }, { x_m: -4, y_m: 30 }] }] };
    world.haul_route = { phase: "HAULING", origin: "Mine", destination: "Crusher", distance_m: 5,
      total_distance_m: 40, remaining_m: 35, elapsed_s: 2, obstacle: { x_m: 0, y_m: 8 },
      obstacle_detected: true, obstacle_radius_m: 0.5, next_instruction: "Continue" };
    const a = frame(world);
    expect(a.source).toBe("REFERENCE_SIMULATION");
    expect(a.roadPointCount).toBeGreaterThan(1000);
    expect(a.entities.map(e => e.id)).toEqual(["vehicle:PEER", "haul-obstacle"]);
    expect(a.egoSize).toEqual(a.entities[0].size);
    const moved = { ...world, vehicles: [{ ...world.vehicles[0], y_m: 2 }, world.vehicles[1]] };
    expect(frame(moved).entities[0].position[2]).toBe(a.entities[0].position[2] + 2);
    // The sampled road moves in the same vehicle frame as the tracked traffic.
    expect(frame(moved).roadPositions[2]).toBeCloseTo(a.roadPositions[2] + 2);
    for (const mode of ["LIVE", "REPLAY"] as const) {
      const result = frame({ ...world, mode });
      expect(result.roadPointCount).toBe(0);
      expect(result.entities).toHaveLength(0);
      expect(result.measuredCount).toBe(1);
    }
  });

  it("places graded terrain below the truck and draws nearby traffic as simulated scan points", () => {
    const world = worldWithReturn("SIMULATED");
    world.spatial_points = [];
    world.vehicles[0] = { ...world.vehicles[0], x_m: 0, y_m: 0, position_confidence: 1 };
    const peer = { ...world.vehicles[0], vehicle_id: "PEER", y_m: 18,
      haul: { phase: "HAULING", payload_fraction: 0, bed_angle_deg: 0,
        phase_progress: 0, cycle: 1, road_elevation_m: -5, road_pitch_deg: -3 } };
    world.vehicles.push(peer);
    world.reference_map = { map_id: "grade", name: "Grade", version: 1, created_at_ms: 0,
      coordinate_frame: "LOCAL_CARTESIAN_METRES", source: "test", features: [{
        feature_id: "haul-grade", feature_type: "ROAD", geometry_type: "POLYLINE",
        points: [{ x_m: 0, y_m: 0 }, { x_m: 0, y_m: 30 }], label: "Haul grade",
        properties: { cartography: "haul-grade", elevations_m: "[0,-8]", width_m: 6 },
      }] };
    const withoutPeer = frame({ ...world, vehicles: [world.vehicles[0]] });
    const withPeer = frame(world);
    expect(withPeer.source).toBe("REFERENCE_SIMULATION");
    expect(withPeer.measuredCount).toBe(0);
    expect(withPeer.roadPointCount).toBeGreaterThan(withoutPeer.roadPointCount + 100);
    expect(withPeer.entities.some(entity => entity.id === "vehicle:PEER" && entity.kind === "scanned_vehicle")).toBe(true);
    expect(Math.min(...Array.from(withPeer.roadPositions).filter((_, i) => i % 3 === 1))).toBeLessThan(-5);
    expect(withPeer.roadColors?.length).toBe(withPeer.roadPositions.length);
    const cloud = withoutPeer;
    const colors = cloud.roadColors!;
    const near = Array.from({ length: cloud.roadPointCount }, (_, i) => i).find(i =>
      Math.hypot(cloud.roadPositions[i * 3], cloud.roadPositions[i * 3 + 2]) < 1);
    const far = Array.from({ length: cloud.roadPointCount }, (_, i) => i).find(i =>
      Math.hypot(cloud.roadPositions[i * 3], cloud.roadPositions[i * 3 + 2]) > 30);
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    expect(colors[near! * 3]).toBeGreaterThan(colors[near! * 3 + 2]);
    expect(colors[far! * 3 + 2]).toBeGreaterThan(colors[far! * 3]);
    expect(frame({ ...world, mode: "LIVE" }).roadPointCount).toBe(0);
  });

  it("moves a cached graded cloud with the current backend pose", () => {
    const world = worldWithReturn("SIMULATED");
    world.spatial_points = [];
    world.vehicles[0] = { ...world.vehicles[0], position_confidence: 1 };
    world.reference_map = { map_id: "moving-grade", name: "Grade", version: 1, created_at_ms: 1,
      coordinate_frame: "LOCAL_CARTESIAN_METRES", source: "test", features: [{
        feature_id: "grade", feature_type: "ROAD", geometry_type: "POLYLINE", label: "Grade",
        points: [{ x_m: 0, y_m: 0 }, { x_m: 0, y_m: 30 }],
        properties: { cartography: "haul-grade", elevations_m: "[0,2]", width_m: 6 },
      }] };
    const first = frame(world);
    const moved = frame({ ...world, generated_at_ms: 1100,
      vehicles: [{ ...world.vehicles[0], y_m: 0.4 }] });
    expect(moved.roadPositions).toBe(first.roadPositions);
    expect(moved.roadTransform?.position[2]).toBeCloseTo(0.4);
    const later = frame({ ...world, generated_at_ms: 1400,
      vehicles: [{ ...world.vehicles[0], y_m: 1.4 }] });
    expect(later.roadPositions).not.toBe(first.roadPositions);
  });

  it("produces a deterministic frame without random points", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Unexpected randomness"); });
    try {
      const world = { ...worldWithReturn("LIVE"), spatial_points: [] };
      expect(frame(world)).toEqual(frame(world));
    } finally { random.mockRestore(); }
  });
});
