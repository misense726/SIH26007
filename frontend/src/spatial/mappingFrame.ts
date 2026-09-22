// Adapted from Claude's d70c1fb vehicle-centred point-cloud view.
import { availableSpatialPoints } from "../state/spatialPoints";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import { truckDisplayGeometry } from "./truckFootprint";
import type { MapFeature, VehiclePose, WorldState } from "../types";
import { clipRoad, localPoint } from "../spatial/routeGeometry";
import { worldPointToVehicle } from "../spatial/spatialProjection";

export const LIDAR_RADIUS_M = 80;
export const SIMULATED_TRUCK_SIZE: [number, number, number] = [3.2, 3.1, 6.2];
const ROAD_POINT_SPACING_M = 0.28;
const MAX_ROAD_POINTS = 28_000;

export interface LidarPath {
  id: string;
  positions: Float32Array;
  closed: boolean;
}

export interface LidarEntity {
  id: string;
  kind: "vehicle" | "obstacle" | "object";
  position: [number, number, number];
  size: [number, number, number];
  yawRad: number;
}

export interface LidarFrame {
  roadPositions: Float32Array;
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
  return [x, Math.max(0, height), -y];
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
    entities.push({
      id: `vehicle:${peer.vehicle_id}`,
      kind: "vehicle",
      position: scenePoint(local.x_m, local.y_m, SIMULATED_TRUCK_SIZE[1] / 2),
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
  if (obstacle) {
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
  const road = simulateMap ? buildRoadData(world, vehicle) : { positions: new Float32Array(), paths: [] };
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

