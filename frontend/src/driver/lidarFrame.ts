import { availableSpatialPoints } from "../state/spatialPoints";
import type { MapFeature, VehiclePose, WorldState } from "../types";
import { clipRoad, localPoint } from "../spatial/routeGeometry";
import { worldPointToVehicle } from "../spatial/spatialProjection";

export const LIDAR_RADIUS_M = 80;
const ROAD_POINT_SPACING_M = 1.6;
const MAX_ROAD_POINTS = 2_500;

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

function heightColor(height: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, height / 4));
  if (t < 0.25) return [0.08, 0.42 + t * 1.6, 1];
  if (t < 0.5) return [0.08, 1, 1 - (t - 0.25) * 2.8];
  if (t < 0.75) return [(t - 0.5) * 3.2, 1, 0.18];
  return [1, 1 - (t - 0.75) * 3.2, 0.08];
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
  if (world.haul_route?.planned_path?.length) {
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
        if (positions.length / 3 >= MAX_ROAD_POINTS) break;
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

  return { positions: new Float32Array(positions), paths };
}

function entitySize(objectType: string): [number, number, number] {
  const type = objectType.toLowerCase();
  if (type.includes("truck") || type.includes("vehicle")) return [3.2, 3.1, 6.2];
  if (type.includes("person")) return [0.8, 1.9, 0.8];
  if (type.includes("rock") || type.includes("obstacle")) return [1.4, 1.3, 1.4];
  return [1.8, 1.8, 1.8];
}

function buildEntities(world: WorldState, vehicle: VehiclePose): LidarEntity[] {
  const entities: LidarEntity[] = [];

  for (const peer of world.vehicles) {
    if (peer.vehicle_id === vehicle.vehicle_id || peer.position_confidence < 0.5) {
      continue;
    }
    const local = localPoint(peer, vehicle);
    if (Math.hypot(local.x_m, local.y_m) > LIDAR_RADIUS_M) continue;
    entities.push({
      id: `vehicle:${peer.vehicle_id}`,
      kind: "vehicle",
      position: scenePoint(local.x_m, local.y_m, 1.55),
      size: [3.2, 3.1, 6.2],
      yawRad: normalizeAngleRadians(
        ((peer.heading_deg - vehicle.heading_deg) * Math.PI) / 180,
      ),
    });
  }

  for (const object of world.live_objects) {
    if (object.confidence < 0.5) continue;
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
    if (detection.confidence < 0.5 || detection.range_m > LIDAR_RADIUS_M) continue;
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

  const obstacle = world.haul_route?.obstacle_detected
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
): LidarFrame {
  const road = buildRoadData(world, vehicle);
  const spatialPoints = availableSpatialPoints(
    world.spatial_points,
    world.sensor_health,
    true,
    world.generated_at_ms,
    vehicle,
    LIDAR_RADIUS_M,
  );
  const returnPositions: number[] = [];
  const returnColors: number[] = [];

  for (const point of spatialPoints) {
    const local = worldPointToVehicle(point, vehicle);
    const position = scenePoint(local.x_m, local.y_m, local.z_m);
    if (!finite(position)) continue;
    returnPositions.push(...position);
    returnColors.push(...heightColor(local.z_m));
  }

  return {
    roadPositions: road.positions,
    returnPositions: new Float32Array(returnPositions),
    returnColors: new Float32Array(returnColors),
    paths: road.paths,
    entities: buildEntities(world, vehicle),
    returnCount: returnPositions.length / 3,
    roadPointCount: road.positions.length / 3,
  };
}
