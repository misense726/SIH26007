// Adapted from Claude's d70c1fb vehicle-centred point-cloud view.
import { availableSpatialPoints } from "../state/spatialPoints";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import { truckDisplayGeometry } from "./truckFootprint";
import type { MapFeature, ReferenceMap, VehiclePose, WorldState } from "../types";
import { clipRoad, localPoint } from "../spatial/routeGeometry";
import { worldPointToVehicle } from "../spatial/spatialProjection";
import { createTerrainField, gradedRoads, grain, type TerrainField } from "../twin/terrainField";
import { buildTruckMesh } from "./truckMesh";

export const LIDAR_RADIUS_M = 80;
export const SIMULATED_TRUCK_SIZE: [number, number, number] = [1.6, 1.65, 3.2];
const ROAD_POINT_SPACING_M = 0.28;
const MAX_ROAD_POINTS = 40_000;

export interface LidarPath {
  id: string;
  positions: Float32Array;
  closed: boolean;
}

export interface LidarEntity {
  id: string;
  kind: "vehicle" | "scanned_vehicle" | "obstacle" | "object";
  position: [number, number, number];
  size: [number, number, number];
  yawRad: number;
}

export interface LidarFrame {
  roadPositions: Float32Array;
  roadColors?: Float32Array;
  roadTransform?: { position: [number, number, number]; yawRad: number };
  returnPositions: Float32Array;
  returnColors: Float32Array;
  paths: LidarPath[];
  entities: LidarEntity[];
  returnCount: number;
  roadPointCount: number;
  source: "MEASURED" | "REFERENCE_SIMULATION" | "SIMULATED_PREVIEW" | "WAITING";
  egoSize: [number, number, number];
  measuredCount: number;
}

export interface SpatialPreview {
  source: "SIMULATED";
  coordinate_frame: "VEHICLE_X_RIGHT_Y_FORWARD_Z_UP";
  points: number[];
  entities: LidarEntity[];
}

const previewBuffers = new WeakMap<SpatialPreview, { positions: Float32Array; colors: Float32Array }>();
function previewCloud(preview: SpatialPreview) {
  const cached = previewBuffers.get(preview);
  if (cached) return cached;
  const positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < preview.points.length && i < 108_000; i += 3) {
    const x = preview.points[i], y = preview.points[i + 1], z = preview.points[i + 2];
    if (!finite([x, y, z])) continue;
    positions.push(...scenePoint(x, y, z));
    colors.push(...heightColor(z, y));
  }
  const cloud = { positions: new Float32Array(positions), colors: new Float32Array(colors) };
  previewBuffers.set(preview, cloud);
  return cloud;
}

function scenePoint(x: number, y: number, height = 0): [number, number, number] {
  return [x, height, -y];
}

function finite(values: number[]): boolean {
  return values.every(Number.isFinite);
}

function normalizeAngleRadians(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function heightColor(height: number, forward = 0): [number, number, number] {
  const t = Math.max(0, Math.min(1, height / 5 + Math.max(0, forward) / 85));
  if (t < 0.25) return [0.32 - t, 0.12 + t * 1.5, 1];
  if (t < 0.5) return [0.07, 0.5 + (t - 0.25) * 2, 1];
  if (t < 0.75) return [(t - 0.5) * 2.8, 1, 1 - (t - 0.5) * 3.6];
  return [1, 1 - (t - 0.75) * 3, 0.1];
}

const distanceColorStops: [number, [number, number, number]][] = [
  [0, [1, 0.08, 0.1]], [4, [1, 0.34, 0.13]],
  [9, [1, 0.75, 0.19]], [18, [0.19, 0.85, 0.82]],
  [36, [0.22, 0.42, 1]], [60, [0.2, 0.32, 0.87]],
];
function distanceColor(distance: number, strength = 1): [number, number, number] {
  const index = distanceColorStops.findIndex(([range]) => distance <= range);
  const upper = index < 1 ? index === 0 ? 1 : distanceColorStops.length - 1 : index;
  const lower = Math.max(0, upper - 1);
  const amount = Math.max(0, Math.min(1,
    (distance - distanceColorStops[lower][0]) / (distanceColorStops[upper][0] - distanceColorStops[lower][0])));
  const from = distanceColorStops[lower][1], to = distanceColorStops[upper][1];
  return [(from[0] + (to[0] - from[0]) * amount) * strength,
    (from[1] + (to[1] - from[1]) * amount) * strength,
    (from[2] + (to[2] - from[2]) * amount) * strength];
}

function roadFeatures(world: WorldState): MapFeature[] {
  const features = world.reference_map?.features ?? [];
  const roads = features.filter((feature) => feature.feature_type === "ROAD");
  if (roads.length > 0) return roads;
  const route = features.find(
    (feature) =>
      feature.feature_type === "ROUTE" || feature.feature_type === "CENTERLINE",
  );
  if (route) return [route];
  if (world.mode === "SIMULATED" && world.haul_route?.planned_path?.length) {
    return [
      {
        feature_id: "planned-path",
        feature_type: "ROUTE",
        geometry_type: "POLYLINE",
        points: world.haul_route.planned_path,
        label: "Planned path",
        properties: {},
      },
    ];
  }
  return [];
}

function buildRoadData(world: WorldState, vehicle: VehiclePose): {
  positions: Float32Array;
  paths: LidarPath[];
} {
  const positions: number[] = [];
  const paths: LidarPath[] = [];

  for (const feature of roadFeatures(world)) {
    if (feature.points.length < 2) continue;
    const isClosed = feature.geometry_type === "POLYGON";
    const edgeCount = isClosed ? feature.points.length : feature.points.length - 1;

    for (let edge = 0; edge < edgeCount; edge++) {
      const start = feature.points[edge];
      const end = feature.points[(edge + 1) % feature.points.length];
      const length = Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m);
      const sampleCount = Math.max(1, Math.ceil(length / ROAD_POINT_SPACING_M));
      for (let sample = 0; sample <= sampleCount; sample++) {
        if (positions.length / 3 >= 12_000) break;
        const t = sample / sampleCount;
        const local = localPoint(
          {
            x_m: start.x_m + (end.x_m - start.x_m) * t,
            y_m: start.y_m + (end.y_m - start.y_m) * t,
          },
          vehicle,
        );
        if (Math.hypot(local.x_m, local.y_m) > LIDAR_RADIUS_M) continue;
        positions.push(...scenePoint(local.x_m, local.y_m, 0.025));
      }
    }

    const localPath = feature.points.map((point) => localPoint(point, vehicle));
    const clipped = isClosed
      ? clipRoad(localPath, LIDAR_RADIUS_M)
      : localPath.filter(
          (point) => Math.hypot(point.x_m, point.y_m) <= LIDAR_RADIUS_M,
        );
    // World-anchored scan lines flow past the ego vehicle as backend poses move.
    if (isClosed && clipped.length >= 3) {
      const spacing = 0.46;
      const minY = Math.ceil(Math.max(vehicle.y_m - 54, Math.min(...feature.points.map(p => p.y_m))) / spacing) * spacing;
      const maxY = Math.min(vehicle.y_m + 54, Math.max(...feature.points.map(p => p.y_m)));
      for (let y = minY; y < maxY && positions.length / 3 < 12_000; y += spacing) {
        const intersections: number[] = [];
        for (let i = 0, j = feature.points.length - 1; i < feature.points.length; j = i++) {
          const a = feature.points[i], b = feature.points[j];
          if ((a.y_m > y) !== (b.y_m > y)) {
            intersections.push(a.x_m + (y - a.y_m) * (b.x_m - a.x_m) / (b.y_m - a.y_m));
          }
        }
        intersections.sort((a, b) => a - b);
        for (let pair = 0; pair + 1 < intersections.length; pair += 2) {
          const minX = Math.ceil(Math.max(vehicle.x_m - 54, intersections[pair]) / spacing) * spacing;
          const maxX = Math.min(vehicle.x_m + 54, intersections[pair + 1]);
          for (let x = minX; x < maxX && positions.length / 3 < 12_000; x += spacing) {
            const local = localPoint({ x_m: x, y_m: y }, vehicle);
            if (Math.abs(local.x_m) <= 24 && local.y_m >= -10 && local.y_m <= 46) {
              positions.push(...scenePoint(local.x_m, local.y_m, 0.025));
            }
          }
        }
      }
    }
    if (clipped.length >= 2) {
      const pathPositions: number[] = [];
      for (const point of clipped) {
        pathPositions.push(...scenePoint(point.x_m, point.y_m, 0.04));
      }
      paths.push({
        id: feature.feature_id,
        positions: new Float32Array(pathPositions),
        closed: isClosed,
      });
    }
  }

  // Simulated berm elevations are illustrative; their XY comes from the map.
  for (const feature of world.reference_map?.features ?? []) {
    if (feature.feature_type !== "BERM") continue;
    for (let edge = 1; edge < feature.points.length; edge++) {
      const start = localPoint(feature.points[edge - 1], vehicle);
      const end = localPoint(feature.points[edge], vehicle);
      const count = Math.ceil(Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m) / 0.25);
      for (let step = 0; step <= Math.min(count, 2000); step++) {
        const t = step / Math.max(1, count);
        const x = start.x_m + (end.x_m - start.x_m) * t;
        const y = start.y_m + (end.y_m - start.y_m) * t;
        if (Math.abs(x) > 25 || y < -10 || y > 46) continue;
        for (let z = 0.12; z <= 2.4 && positions.length / 3 < MAX_ROAD_POINTS; z += 0.16) {
          positions.push(...scenePoint(x, y, z));
        }
      }
    }
  }

  return { positions: new Float32Array(positions), paths };
}

type TerrainSample = ReturnType<TerrainField>;
interface TerrainCache { field: TerrainField; samples: Map<string, TerrainSample> }
const terrainCaches = new Map<string, TerrainCache>();
const terrainKey = (map: ReferenceMap) => `${map.map_id}:${map.version}:${map.created_at_ms}`;
function terrainFor(map: ReferenceMap): (x: number, y: number) => TerrainSample {
  // WebSocket snapshots deserialize the same map into new arrays on every tick.
  const key = terrainKey(map);
  let cache = terrainCaches.get(key);
  if (!cache) {
    cache = { field: createTerrainField(map.features), samples: new Map() };
    terrainCaches.set(key, cache);
    if (terrainCaches.size > 2) terrainCaches.delete(terrainCaches.keys().next().value!);
  }
  return (x, y) => {
    const position = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    const saved = cache!.samples.get(position);
    if (saved) return saved;
    const sample = cache!.field(x, y);
    if (cache!.samples.size >= 60_000) {
      const old = cache!.samples.keys();
      for (let i = 0; i < 15_000; i++) cache!.samples.delete(old.next().value!);
    }
    cache!.samples.set(position, sample);
    return sample;
  };
}

type TruckSample = [number, number, number, boolean];
const truckSamples: TruckSample[] = (() => {
  const samples: TruckSample[] = [];
  const surfaces = buildTruckMesh().filter(face => face.part !== "truck-ore-cargo" &&
    face.part !== "truck-solid-core" && face.part !== "truck-undercarriage");
  for (const surface of surfaces) {
    const wheel = surface.part.startsWith("wheel");
    for (let triangle = 1; triangle < surface.points.length - 1; triangle++) {
      const [a, b, c] = [surface.points[0], surface.points[triangle], surface.points[triangle + 1]];
      const length = Math.max(Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m, a.z_m - b.z_m),
        Math.hypot(a.x_m - c.x_m, a.y_m - c.y_m, a.z_m - c.z_m),
        Math.hypot(b.x_m - c.x_m, b.y_m - c.y_m, b.z_m - c.z_m));
      const steps = Math.max(1, Math.min(18, Math.ceil(length / 0.3)));
      for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps, w = 1 - u - v;
        samples.push([a.x_m * w + b.x_m * u + c.x_m * v,
          a.y_m * w + b.y_m * u + c.y_m * v,
          a.z_m * w + b.z_m * u + c.z_m * v, wheel]);
      }
    }
  }
  const minX = Math.min(...samples.map(p => p[0])), maxX = Math.max(...samples.map(p => p[0]));
  const minY = Math.min(...samples.map(p => p[1])), maxY = Math.max(...samples.map(p => p[1]));
  const minZ = Math.min(...samples.map(p => p[2])), maxZ = Math.max(...samples.map(p => p[2]));
  const body = samples.filter(sample => !sample[3]);
  const wheels = samples.filter(sample => sample[3]);
  const selected = [...body.filter((_, i) => i % Math.max(1, Math.ceil(body.length / 360)) === 0),
    ...wheels.filter((_, i) => i % Math.max(1, Math.ceil(wheels.length / 100)) === 0)];
  return selected.map(([x, y, z, wheel]) => [(x - (minX + maxX) / 2) * SIMULATED_TRUCK_SIZE[0] / (maxX - minX),
      (y - (minY + maxY) / 2) * SIMULATED_TRUCK_SIZE[2] / (maxY - minY),
      (z - minZ) * SIMULATED_TRUCK_SIZE[1] / (maxZ - minZ), wheel]);
})();

function sampleGradedData(world: WorldState, vehicle: VehiclePose): {
  positions: Float32Array; colors: Float32Array; paths: LidarPath[]; egoHeight: number;
} {
  const field = terrainFor(world.reference_map!);
  const egoHeight = vehicle.haul?.road_elevation_m ?? field(vehicle.x_m, vehicle.y_m).elevation;
  const positions: number[] = [], colors: number[] = [];
  const heading = vehicle.heading_deg * Math.PI / 180;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const emit = (x: number, y: number, z: number, color: [number, number, number]) => {
    positions.push(x, z, -y);
    colors.push(color[0], color[1], color[2]);
  };
  const sampleGround = (spacing: number, near: boolean) => {
    const radius = near ? 12 : 62;
    for (let y = Math.floor((vehicle.y_m - radius) / spacing) * spacing; y <= vehicle.y_m + radius; y += spacing) {
      for (let x = Math.floor((vehicle.x_m - radius) / spacing) * spacing; x <= vehicle.x_m + radius; x += spacing) {
        const dx = x - vehicle.x_m, dy = y - vehicle.y_m;
        const localX = dx * cos - dy * sin, localY = dx * sin + dy * cos;
        const distance = Math.hypot(localX, localY);
        if (Math.abs(localX) > 27 || localY < -12 || localY > 46 ||
          (near ? distance > 10 : distance <= 10)) continue;
        const ground = field(x, y);
        const elevation = ground.elevation - egoHeight;
        if (elevation > 6.5) continue;
        const shade = 0.86 + 0.14 * grain(x * 0.6, y * 0.6);
        const color = distanceColor(distance, (ground.road ? 0.74 : ground.face > 0.15 ? 0.85 : 0.67) * shade);
        emit(localX, localY, elevation, color);
      }
    }
  };
  // World-anchored sampling keeps each scan return in place as the vehicle moves.
  sampleGround(0.72, false);
  sampleGround(0.27, true);

  // Ordered height bands mark the mapped road walls, including the pit access cut.
  const wallFeatures = world.reference_map!.features.filter(feature =>
    feature.feature_type === "BERM" || feature.properties.cartography === "graded-access");
  for (const feature of wallFeatures) {
    const count = feature.geometry_type === "POLYGON" ? feature.points.length : feature.points.length - 1;
    for (let edge = 0; edge < count && positions.length / 3 < 20_000; edge++) {
      const a = feature.points[edge], b = feature.points[(edge + 1) % feature.points.length];
      const length = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
      const steps = Math.max(1, Math.ceil(length / 0.34));
      for (let step = 0; step <= steps && positions.length / 3 < 20_000; step++) {
        const t = step / steps;
        const x = a.x_m + (b.x_m - a.x_m) * t, y = a.y_m + (b.y_m - a.y_m) * t;
        const local = localPoint({ x_m: x, y_m: y }, vehicle);
        const distance = Math.hypot(local.x_m, local.y_m);
        if (Math.abs(local.x_m) > 27 || local.y_m < -10 || local.y_m > 45) continue;
        const top = field(x, y).elevation - egoHeight;
        if (top < -12 || top - 2.2 > 6.5) continue;
        const color = distanceColor(distance, 0.87);
        for (let z = 0; z <= 2.2; z += distance < 12 ? 0.2 : 0.34) {
          if (top - z <= 6.5) emit(local.x_m, local.y_m, top - z, color);
        }
      }
    }
  }

  // Loose stones stay on level ground; only the route obstruction is red.
  for (let gy = Math.floor((vehicle.y_m - 65) / 7); gy <= Math.ceil((vehicle.y_m + 65) / 7); gy++) {
    for (let gx = Math.floor((vehicle.x_m - 65) / 7); gx <= Math.ceil((vehicle.x_m + 65) / 7); gx++) {
      if (grain(gx, gy) < 0.64) continue;
      const x = (gx + 0.3 + grain(gx + 7, gy) * 0.4) * 7;
      const y = (gy + 0.3 + grain(gx, gy + 9) * 0.4) * 7;
      const local = localPoint({ x_m: x, y_m: y }, vehicle);
      if (Math.abs(local.x_m) > 27 || local.y_m < -11 || local.y_m > 45) continue;
      const ground = field(x, y);
      const slope = Math.max(Math.abs(field(x + 0.5, y).elevation - ground.elevation),
        Math.abs(field(x - 0.5, y).elevation - ground.elevation),
        Math.abs(field(x, y + 0.5).elevation - ground.elevation),
        Math.abs(field(x, y - 0.5).elevation - ground.elevation));
      if (ground.road || ground.face > 0.08 || slope > 0.18 ||
        ground.edge < 1.2 || ground.edge > 10) continue;
      const size = 0.55 + grain(gx + 11, gy + 17) * 0.9;
      for (let row = 0; row <= 5; row++) for (let column = 0; column < 14; column++) {
        const angle = column * Math.PI * 2 / 14;
        const rise = row / 5;
        const radiusAtHeight = size * Math.sin((0.15 + rise * 0.82) * Math.PI);
        const bx = x + Math.cos(angle) * radiusAtHeight;
        const by = y + Math.sin(angle) * radiusAtHeight * 0.7;
        const rockLocal = localPoint({ x_m: bx, y_m: by }, vehicle);
        emit(rockLocal.x_m, rockLocal.y_m,
          ground.elevation - egoHeight + rise * size * 1.1,
          distanceColor(Math.hypot(rockLocal.x_m, rockLocal.y_m), 0.78));
      }
    }
  }

  const rock = world.haul_route?.obstacle;
  if (rock) {
    const local = localPoint(rock, vehicle);
    if (Math.abs(local.x_m) < 27 && local.y_m > -10 && local.y_m < 45) {
      const base = field(rock.x_m, rock.y_m).elevation - egoHeight;
      const radius = Math.max(0.4, world.haul_route?.obstacle_radius_m ?? 0.4);
      for (let row = 0; row <= 9; row++) for (let column = 0; column < 24; column++) {
        const angle = column * Math.PI * 2 / 24;
        const rise = row / 9;
        const width = radius * (1 - rise * rise) * (0.88 + grain(column, row) * 0.2);
        const point = localPoint({ x_m: rock.x_m + Math.cos(angle) * width,
          y_m: rock.y_m + Math.sin(angle) * width }, vehicle);
        emit(point.x_m, point.y_m, base + rise * radius * 1.6,
          [1, 0.035 + rise * 0.1, 0.08]);
      }
    }
  }

  // A short dotted forward mark reads as a scan guide, not a second road grid.
  for (const row of [2.8, 4.7, 6.6]) for (let i = -10; i <= 10; i++) {
    const localX = i * 0.11, localY = row + 0.23 * (1 - Math.abs(i) / 10);
    const worldX = vehicle.x_m + localX * cos + localY * sin;
    const worldY = vehicle.y_m - localX * sin + localY * cos;
    emit(localX, localY, field(worldX, worldY).elevation - egoHeight + 0.09,
      [0.08, 1, 0.27]);
  }
  // Surface samples follow backend fleet poses; they are illustrative scan geometry,
  // not measured ToF returns or objects used by the safety controller.
  for (const peer of world.vehicles) {
    if (peer.vehicle_id === vehicle.vehicle_id || peer.mode !== world.mode || peer.position_confidence < 0.5) continue;
    const relative = localPoint(peer, vehicle);
    if (Math.abs(relative.x_m) > 31 || relative.y_m < -16 || relative.y_m > 59) continue;
    const yaw = peer.heading_deg * Math.PI / 180;
    const peerCos = Math.cos(yaw), peerSin = Math.sin(yaw);
    const base = peer.haul?.road_elevation_m ?? field(peer.x_m, peer.y_m).elevation;
    for (const [truckX, truckY, truckZ, wheel] of truckSamples) {
      const wx = peer.x_m + truckX * peerCos + truckY * peerSin;
      const wy = peer.y_m - truckX * peerSin + truckY * peerCos;
      const local = localPoint({ x_m: wx, y_m: wy }, vehicle);
      positions.push(...scenePoint(local.x_m, local.y_m, base - egoHeight + truckZ));
      colors.push(wheel ? 0.35 : 0.48, wheel ? 0.47 : 0.87, wheel ? 0.84 : 1);
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), paths: [], egoHeight };
}

let gradedFrameCache: {
  mapKey: string; timestamp: number; pose: VehiclePose; height: number;
  vehicleCount: number; rockKey: string;
  data: ReturnType<typeof sampleGradedData>;
} | null = null;

function buildGradedData(world: WorldState, vehicle: VehiclePose) {
  const mapKey = terrainKey(world.reference_map!);
  const rock = world.haul_route?.obstacle;
  const rockKey = rock ? `${rock.x_m},${rock.y_m}` : "";
  const cached = gradedFrameCache;
  const age = cached ? world.generated_at_ms - cached.timestamp : Infinity;
  const moved = cached ? Math.hypot(vehicle.x_m - cached.pose.x_m, vehicle.y_m - cached.pose.y_m) : Infinity;
  const headingChange = cached ? (vehicle.heading_deg - cached.pose.heading_deg + 540) % 360 - 180 : Infinity;
  if (!cached || cached.mapKey !== mapKey || age < 0 || age >= 350 || moved >= 1.2 ||
    Math.abs(headingChange) >= 9 || cached.vehicleCount !== world.vehicles.length || cached.rockKey !== rockKey) {
    const data = sampleGradedData(world, vehicle);
    gradedFrameCache = { mapKey, timestamp: world.generated_at_ms, pose: vehicle,
      height: data.egoHeight, vehicleCount: world.vehicles.length, rockKey, data };
  }
  const anchor = gradedFrameCache!;
  const yawRad = (vehicle.heading_deg - anchor.pose.heading_deg) * Math.PI / 180;
  const heading = vehicle.heading_deg * Math.PI / 180;
  const dx = anchor.pose.x_m - vehicle.x_m, dy = anchor.pose.y_m - vehicle.y_m;
  const x = dx * Math.cos(heading) - dy * Math.sin(heading);
  const y = dx * Math.sin(heading) + dy * Math.cos(heading);
  const height = vehicle.haul?.road_elevation_m ?? terrainFor(world.reference_map!)(vehicle.x_m, vehicle.y_m).elevation;
  return { ...anchor.data, transform: {
    position: [x, anchor.height - height, -y] as [number, number, number], yawRad,
  } };
}

function entitySize(objectType: string): [number, number, number] {
  const type = objectType.toLowerCase();
  if (type.includes("truck") || type.includes("vehicle")) return SIMULATED_TRUCK_SIZE;
  if (type.includes("person")) return [0.8, 1.9, 0.8];
  if (type.includes("rock") || type.includes("obstacle")) return [1.4, 1.3, 1.4];
  return [1.8, 1.8, 1.8];
}

function buildEntities(world: WorldState, vehicle: VehiclePose): LidarEntity[] {
  const entities: LidarEntity[] = [];

  for (const peer of world.vehicles) {
    if (peer.vehicle_id === vehicle.vehicle_id || peer.position_confidence < 0.5 || peer.mode !== world.mode) {
      continue;
    }
    const local = localPoint(peer, vehicle);
    if (Math.hypot(local.x_m, local.y_m) > LIDAR_RADIUS_M) continue;
    const scanned = world.mode === "SIMULATED" && world.reference_map &&
      gradedRoads(world.reference_map.features).length > 0;
    if (scanned && (Math.abs(local.x_m) > 28 || local.y_m < -12 || local.y_m > 46)) continue;
    entities.push({
      id: `vehicle:${peer.vehicle_id}`,
      kind: scanned ? "scanned_vehicle" : "vehicle",
      position: scenePoint(local.x_m, local.y_m,
        SIMULATED_TRUCK_SIZE[1] / 2 + (peer.haul?.road_elevation_m ?? 0) - (vehicle.haul?.road_elevation_m ?? 0)),
      size: SIMULATED_TRUCK_SIZE,
      yawRad: normalizeAngleRadians(
        ((peer.heading_deg - vehicle.heading_deg) * Math.PI) / 180,
      ),
    });
  }

  for (const object of world.live_objects) {
    if (object.confidence < 0.5 || object.mode !== world.mode ||
      world.generated_at_ms - object.timestamp_ms > 2000) continue;
    const local = localPoint(object, vehicle);
    if (Math.hypot(local.x_m, local.y_m) > LIDAR_RADIUS_M) continue;
    const size = entitySize(object.object_type);
    entities.push({
      id: `object:${object.object_id}`,
      kind: "object",
      position: scenePoint(local.x_m, local.y_m, size[1] / 2),
      size,
      yawRad: 0,
    });
  }

  for (const detection of world.radar_objects) {
    if (detection.confidence < 0.5 || detection.range_m > LIDAR_RADIUS_M ||
      detection.mode !== world.mode || world.generated_at_ms - detection.timestamp_ms > 2000) continue;
    const bearing = (detection.bearing_deg * Math.PI) / 180;
    const x = Math.sin(bearing) * detection.range_m;
    const y = Math.cos(bearing) * detection.range_m;
    entities.push({
      id: `radar:${detection.detection_id}`,
      kind: "object",
      position: scenePoint(x, y, 1),
      size: [1.8, 2, 1.8],
      yawRad: 0,
    });
  }

  const obstacle = world.mode === "SIMULATED" && world.haul_route?.obstacle_detected
    ? world.haul_route.obstacle
    : null;
  if (obstacle && !(world.reference_map && gradedRoads(world.reference_map.features).length > 0)) {
    const local = localPoint(obstacle, vehicle);
    if (Math.hypot(local.x_m, local.y_m) <= LIDAR_RADIUS_M) {
      const radius = Math.max(0.3, world.haul_route?.obstacle_radius_m ?? 0.45);
      entities.push({
        id: "haul-obstacle",
        kind: "obstacle",
        position: scenePoint(local.x_m, local.y_m, radius),
        size: [radius * 2, radius * 2, radius * 2],
        yawRad: 0,
      });
    }
  }

  return entities.filter((entity) => finite([...entity.position, ...entity.size, entity.yawRad]));
}

export function buildLidarFrame(
  world: WorldState,
  vehicle: VehiclePose,
  sensors: SensorDisplaySetting[],
  connected: boolean,
  preview?: SpatialPreview | null,
): LidarFrame {
  const simulateMap = connected && world.mode === "SIMULATED" && vehicle.position_confidence >= 0.5;
  const road: { positions: Float32Array; paths: LidarPath[]; colors?: Float32Array;
    transform?: { position: [number, number, number]; yawRad: number } } =
    simulateMap ? world.reference_map && gradedRoads(world.reference_map.features).length > 0
    ? buildGradedData(world, vehicle) : buildRoadData(world, vehicle)
    : { positions: new Float32Array(), paths: [] };
  const spatialPoints = availableSpatialPoints(
    world.spatial_points,
    world.sensor_health,
    connected,
    world.generated_at_ms,
    vehicle,
    LIDAR_RADIUS_M,
    sensors,
  );
  const returnPositions: number[] = [];
  const returnColors: number[] = [];

  for (const point of spatialPoints) {
    const local = worldPointToVehicle(point, vehicle);
    // ToF reconstruction is planar. height_hint_m is not a measured altitude.
    const position = scenePoint(local.x_m, local.y_m, 0.04);
    if (!finite(position)) continue;
    returnPositions.push(...position);
    returnColors.push(0.18, 0.88, 1);
  }

  const measuredCount = returnPositions.length / 3;
  const previewActive = measuredCount === 0 && road.positions.length === 0 && world.mode !== "REPLAY" && !!preview;
  const footprint = truckDisplayGeometry(sensors).footprint;
  const cloud = previewActive ? previewCloud(preview!) : {
    positions: new Float32Array(returnPositions), colors: new Float32Array(returnColors),
  };
  // The synthetic context and measured observations have separate buffers.
  const source = previewActive ? "SIMULATED_PREVIEW" : road.positions.length ? "REFERENCE_SIMULATION"
    : measuredCount ? "MEASURED" : "WAITING";

  return {
    roadPositions: road.positions,
    roadColors: road.colors,
    roadTransform: road.transform,
    returnPositions: cloud.positions,
    returnColors: cloud.colors,
    paths: road.paths,
    entities: previewActive ? preview!.entities : connected && vehicle.position_confidence >= 0.5
      ? buildEntities(world, vehicle) : [],
    returnCount: cloud.positions.length / 3,
    roadPointCount: road.positions.length / 3,
    source,
    measuredCount,
    egoSize: source === "MEASURED" || source === "WAITING"
      ? [footprint.right - footprint.left, 0.45, footprint.front - footprint.rear] : SIMULATED_TRUCK_SIZE,
  };
}

