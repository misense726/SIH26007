import { Fragment, type ReactNode } from "react";
import type { VehiclePose, WorldState } from "../types";
import {
  cameraDepthForVehiclePoint,
  projectVehiclePointWithCamera,
  type CameraViewConfig,
  type VehiclePoint3D,
} from "./spatialProjection";
import { clipRoad, localPoint } from "./routeGeometry";
import { Vehicle3DTruck } from "./Vehicle3DTruck";

function polygon(points: VehiclePoint3D[], camera: CameraViewConfig): string {
  return points
    .map((p) => {
      const s = projectVehiclePointWithCamera(p, camera);
      return `${s.x.toFixed(2)},${s.y.toFixed(2)}`;
    })
    .join(" ");
}

export function HaulRoad({
  world,
  vehicle,
  camera,
}: {
  world: WorldState;
  vehicle: VehiclePose;
  camera: CameraViewConfig;
}) {
  if (!world.haul_route) return null;
  return (
    <g className="haul-road-layer" aria-label="Reference haul road">
      {world.reference_map?.features
        .filter((f) => f.feature_type === "ROAD")
        .map((f) => (
          <polygon
            key={f.feature_id}
            points={polygon(
              clipRoad(f.points.map((p) => localPoint(p, vehicle))),
              camera,
            )}
            fill="#34404a"
            stroke="#c1a46b"
            strokeWidth="5"
          />
        ))}
      {world.reference_map?.features
        .filter((f) => f.feature_type === "ROUTE")
        .flatMap((f) => {
          const segments: ReactNode[] = [];
          for (let i = 1; i < f.points.length; i++) {
            const start = f.points[i - 1],
              end = f.points[i];
            const length = Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m);
            for (let t = 0; t < length; t += 1.5) {
              const point = {
                x_m: start.x_m + ((end.x_m - start.x_m) * t) / length,
                y_m: start.y_m + ((end.y_m - start.y_m) * t) / length,
              };
              const local = localPoint(point, vehicle);
              if (Math.hypot(local.x_m, local.y_m) > 10) continue;
              const next = localPoint(
                {
                  x_m: point.x_m + ((end.x_m - start.x_m) * 0.65) / length,
                  y_m: point.y_m + ((end.y_m - start.y_m) * 0.65) / length,
                },
                vehicle,
              );
              const a = projectVehiclePointWithCamera(local, camera),
                b = projectVehiclePointWithCamera(next, camera);
              segments.push(
                <line
                  key={`${f.feature_id}-${i}-${t}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#7dd3fc"
                  strokeWidth="4"
                  opacity="0.7"
                  strokeLinecap="round"
                />,
              );
            }
          }
          return segments;
        })}
    </g>
  );
}

function RoadObstacle({
  point,
  radius,
  camera,
}: {
  point: VehiclePoint3D;
  radius: number;
  camera: CameraViewConfig;
}) {
  const vertices = [0, 0.75].flatMap((z_m) => [
    { x_m: point.x_m - radius, y_m: point.y_m - radius, z_m },
    { x_m: point.x_m + radius, y_m: point.y_m - radius, z_m },
    { x_m: point.x_m + radius, y_m: point.y_m + radius, z_m },
    { x_m: point.x_m - radius, y_m: point.y_m + radius, z_m },
  ]);
  const faces = [
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
    [4, 5, 6, 7],
  ]
    .map((indices, i) => ({ i, points: indices.map((n) => vertices[n]) }))
    .sort(
      (a, b) =>
        b.points.reduce(
          (sum, p) => sum + cameraDepthForVehiclePoint(p, camera),
          0,
        ) -
        a.points.reduce(
          (sum, p) => sum + cameraDepthForVehiclePoint(p, camera),
          0,
        ),
    );
  const label = projectVehiclePointWithCamera({ ...point, z_m: 1.15 }, camera);
  return (
    <g aria-label="Road obstruction" className="haul-obstacle">
      {faces.map((f) => (
        <polygon
          key={f.i}
          points={polygon(f.points, camera)}
          fill={f.i === 4 ? "#fbbf24" : f.i % 2 ? "#9a3412" : "#c2410c"}
          stroke="#fdba74"
          strokeWidth="1.2"
        />
      ))}
      <text
        x={label.x}
        y={label.y}
        textAnchor="middle"
        fill="#fef3c7"
        fontSize="12"
        fontWeight="700"
      >
        Road obstruction
      </text>
    </g>
  );
}

export function HaulTraffic({
  world,
  vehicle,
  camera,
  children,
}: {
  world: WorldState;
  vehicle: VehiclePose;
  camera: CameraViewConfig;
  children: ReactNode;
}) {
  const entities = [
    {
      id: vehicle.vehicle_id,
      point: { x_m: 0, y_m: 0, z_m: 0 },
      node: children,
    },
  ];
  if (world.haul_route) {
    for (const peer of world.vehicles) {
      if (
        peer.vehicle_id === vehicle.vehicle_id ||
        peer.position_confidence < 0.5
      )
        continue;
      const point = localPoint(peer, vehicle);
      if (Math.hypot(point.x_m, point.y_m) > 10) continue;
      entities.push({
        id: peer.vehicle_id,
        point,
        node: (
          <Vehicle3DTruck
            sensors={[]}
            readings={[]}
            callsign={peer.vehicle_id}
            isPrimary={false}
            showSensorMounts={false}
            showPerimeterShield={false}
            imuOrientation={{
              pitch_deg: 0,
              roll_deg: 0,
              yaw_deg: peer.heading_deg - vehicle.heading_deg,
            }}
            cameraConfig={camera}
            sceneOffset={point}
          />
        ),
      });
    }
    const obstacle = world.haul_route.obstacle;
    if (obstacle) {
      const point = localPoint(obstacle, vehicle);
      if (Math.hypot(point.x_m, point.y_m) <= 10)
        entities.push({
          id: "road-obstruction",
          point,
          node: (
            <RoadObstacle
              point={point}
              radius={world.haul_route.obstacle_radius_m}
              camera={camera}
            />
          ),
        });
    }
  }
  entities.sort(
    (a, b) =>
      cameraDepthForVehiclePoint(b.point, camera) -
      cameraDepthForVehiclePoint(a.point, camera),
  );
  return (
    <>
      {entities.map((e) => (
        <Fragment key={e.id}>{e.node}</Fragment>
      ))}
    </>
  );
}
