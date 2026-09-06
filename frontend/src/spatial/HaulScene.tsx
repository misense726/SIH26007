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
        .filter(
          (f) => f.feature_type === "ROAD" || f.feature_type === "HAZARD_ZONE",
        )
        .map((f) => (
          <polygon
            key={f.feature_id}
            points={polygon(
              clipRoad(f.points.map((p) => localPoint(p, vehicle))),
              camera,
            )}
            fill={f.feature_type === "ROAD" ? "#756d58" : "#595644"}
            stroke="#8d8367"
            strokeWidth="1.5"
          />
        ))}
    </g>
  );
}

function RoadObstacle({
  point,
  radius,
  camera,
  label = "Rock",
  height = radius * 1.2,
}: {
  point: VehiclePoint3D;
  radius: number;
  camera: CameraViewConfig;
  label?: string;
  height?: number;
}) {
  const vertices = [0, height].flatMap((z_m) => [
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
  const labelPoint = projectVehiclePointWithCamera(
    { ...point, z_m: height + 0.4 },
    camera,
  );
  return (
    <g
      aria-label={label === "Rock" ? "Road obstruction" : label}
      className="haul-obstacle"
    >
      {faces.map((f) => (
        <polygon
          key={f.i}
          points={polygon(f.points, camera)}
          fill={f.i === 4 ? "#a6a18c" : f.i % 2 ? "#595b53" : "#79796a"}
          stroke="#c7b894"
          strokeWidth="1.2"
        />
      ))}
      <text
        x={labelPoint.x}
        y={labelPoint.y}
        textAnchor="middle"
        fill="#fef3c7"
        fontSize="12"
        fontWeight="700"
      >
        {label}
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
    const crusher = world.reference_map?.features.find(
      (f) => f.feature_type === "DESTINATION",
    )?.points[0];
    if (crusher) {
      const point = localPoint(
        { x_m: crusher.x_m + 4, y_m: crusher.y_m },
        vehicle,
      );
      if (Math.hypot(point.x_m, point.y_m) < 14)
        entities.push({
          id: "crusher",
          point,
          node: (
            <RoadObstacle
              point={point}
              radius={1.5}
              height={2.8}
              camera={camera}
              label="Crusher"
            />
          ),
        });
    }
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
    if (obstacle && world.haul_route.obstacle_detected) {
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
      {world.haul_route?.phase === "ARRIVED" &&
        world.haul_route.destination === "Dump point" && (
          <g aria-label="Unloading ore at crusher">
            {Array.from({ length: 6 }, (_, i) => {
              const start = projectVehiclePointWithCamera(
                { x_m: ((i % 3) - 1) * 0.25, y_m: -1, z_m: 1.1 },
                camera,
              );
              const end = projectVehiclePointWithCamera(
                { x_m: ((i % 3) - 1) * 0.3, y_m: -2, z_m: 0.1 },
                camera,
              );
              return (
                <circle key={i} r="3" fill="#8e6a4c">
                  <animate
                    attributeName="cx"
                    values={`${start.x};${end.x}`}
                    dur="0.9s"
                    begin={`${i * 0.15}s`}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="cy"
                    values={`${start.y};${end.y}`}
                    dur="0.9s"
                    begin={`${i * 0.15}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              );
            })}
          </g>
        )}
    </>
  );
}
