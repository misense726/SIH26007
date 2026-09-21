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

export function demoRockPoint(world: WorldState): { x_m: number; y_m: number } | null {
  if (world.mode !== "SIMULATED") return null;
  const route = world.reference_map?.features.find(
    (feature) => feature.feature_type === "ROUTE",
  )?.points;
  if (!route || route.length < 5) return null;

  const index = 3;
  const previous = route[index - 1];
  const next = route[index + 1];
  const tangentX = next.x_m - previous.x_m;
  const tangentY = next.y_m - previous.y_m;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const rightX = tangentY / tangentLength;
  const rightY = -tangentX / tangentLength;

  return {
    x_m: route[index].x_m + rightX * 1.55,
    y_m: route[index].y_m + rightY * 1.55,
  };
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
  if (world.mode !== "SIMULATED" || !world.haul_route) return null;
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

function shadeColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = Math.max(0.28, Math.min(1.35, factor));
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

function surfaceNormal3D(points: VehiclePoint3D[]): VehiclePoint3D {
  if (points.length < 3) return { x_m: 0, y_m: 0, z_m: 1 };
  const ax = points[1].x_m - points[0].x_m;
  const ay = points[1].y_m - points[0].y_m;
  const az = points[1].z_m - points[0].z_m;
  const bx = points[2].x_m - points[0].x_m;
  const by = points[2].y_m - points[0].y_m;
  const bz = points[2].z_m - points[0].z_m;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x_m: nx / len, y_m: ny / len, z_m: nz / len };
}

/**
 * Realistic multi-faceted 3D chiseled rock boulder.
 * Replaces the flat rectangular box with authentic quarry rock geometry.
 */
function RoadObstacle({
  point,
  radius,
  camera,
  label = "Rock",
  height = radius * 1.3,
}: {
  point: VehiclePoint3D;
  radius: number;
  camera: CameraViewConfig;
  label?: string;
  height?: number;
}) {
  const rMults = [0.94, 1.16, 0.85, 1.1, 0.88, 1.14];
  const midRMults = [0.8, 1.02, 0.72, 0.94, 0.82, 0.98];
  const midHMults = [0.42, 0.54, 0.44, 0.52, 0.45, 0.5];

  const groundRing: VehiclePoint3D[] = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i * Math.PI) / 3;
    const r = radius * rMults[i];
    return {
      x_m: point.x_m + Math.cos(a) * r,
      y_m: point.y_m + Math.sin(a) * r,
      z_m: 0,
    };
  });

  const midRing: VehiclePoint3D[] = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i * Math.PI) / 3 + 0.26;
    const r = radius * midRMults[i];
    return {
      x_m: point.x_m + Math.cos(a) * r,
      y_m: point.y_m + Math.sin(a) * r,
      z_m: height * midHMults[i],
    };
  });

  const apex0: VehiclePoint3D = {
    x_m: point.x_m - radius * 0.22,
    y_m: point.y_m - radius * 0.15,
    z_m: height * 0.98,
  };
  const apex1: VehiclePoint3D = {
    x_m: point.x_m + radius * 0.24,
    y_m: point.y_m + radius * 0.18,
    z_m: height * 1.04,
  };

  const faces: Array<{ points: VehiclePoint3D[]; key: string }> = [];

  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    faces.push({
      key: `low-${i}`,
      points: [groundRing[i], groundRing[next], midRing[next], midRing[i]],
    });
  }

  faces.push(
    { key: "up-0", points: [midRing[0], midRing[1], apex1] },
    { key: "up-1", points: [midRing[1], midRing[2], apex1] },
    { key: "up-2", points: [midRing[2], midRing[3], apex0] },
    { key: "up-3", points: [midRing[3], midRing[4], apex0] },
    { key: "up-4", points: [midRing[4], midRing[5], apex0] },
    { key: "up-5", points: [midRing[5], midRing[0], apex1] },
    { key: "top", points: [apex0, apex1, midRing[2]] },
  );

  const lightDir = { x_m: -0.38, y_m: 0.42, z_m: 0.82 };
  const lightLen = Math.hypot(lightDir.x_m, lightDir.y_m, lightDir.z_m);
  const lx = lightDir.x_m / lightLen;
  const ly = lightDir.y_m / lightLen;
  const lz = lightDir.z_m / lightLen;

  const sortedFaces = faces
    .map((f) => {
      const normal = surfaceNormal3D(f.points);
      const dot = normal.x_m * lx + normal.y_m * ly + normal.z_m * lz;
      const lightFactor = 0.45 + 0.55 * Math.max(0, dot);
      const fill = shadeColor("#7a6952", lightFactor);
      const depth =
        f.points.reduce(
          (sum, p) => sum + cameraDepthForVehiclePoint(p, camera),
          0,
        ) / f.points.length;
      return {
        ...f,
        depth,
        fill,
        isFacingCamera: cameraDepthForVehiclePoint(normal, camera) < 0.0001,
      };
    })
    .filter((f) => f.isFacingCamera)
    .sort((a, b) => b.depth - a.depth);

  const shadowPoints = groundRing.map((p) => ({
    ...p,
    x_m: p.x_m + 0.08,
    y_m: p.y_m - 0.06,
  }));

  const labelPoint = projectVehiclePointWithCamera(
    { ...point, z_m: height + 0.35 },
    camera,
  );

  return (
    <g
      aria-label={label === "Rock" ? "Road obstruction" : label}
      className="haul-obstacle"
    >
      {/* Ground Contact Shadow */}
      <polygon
        points={polygon(shadowPoints, camera)}
        fill="rgba(8, 10, 14, 0.55)"
      />

      {/* 3D Chiseled Boulder Facets */}
      {sortedFaces.map((f) => (
        <polygon
          key={f.key}
          points={polygon(f.points, camera)}
          fill={f.fill}
          stroke="#382e22"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      ))}

      {/* Floating HUD Tag */}
      <g transform={`translate(${labelPoint.x}, ${labelPoint.y - 12})`}>
        <rect
          x="-52"
          y="-12"
          width="104"
          height="18"
          rx="5"
          fill="rgba(15, 23, 42, 0.94)"
          stroke="#f59e0b"
          strokeWidth="1.2"
          filter="drop-shadow(0 2px 8px rgba(0,0,0,0.5))"
        />
        <circle cx="-40" cy="-3" r="3" fill="#f59e0b" />
        <text
          x="6"
          y="1"
          textAnchor="middle"
          fill="#fef3c7"
          fontSize="9.5"
          fontWeight="800"
          fontFamily="var(--mono)"
          letterSpacing="0.04em"
        >
          {label === "Rock" ? "ROCK OBSTACLE" : label.toUpperCase()}
        </text>
      </g>
    </g>
  );
}

/**
 * 3D Crusher Receiving Plant with angled hopper walls and hazard-striped apron.
 */
function CrusherPlant3D({
  point,
  camera,
}: {
  point: VehiclePoint3D;
  camera: CameraViewConfig;
}) {
  const x = point.x_m;
  const y = point.y_m;

  const pad: VehiclePoint3D[] = [
    { x_m: x - 2.8, y_m: y - 2.8, z_m: 0 },
    { x_m: x + 2.8, y_m: y - 2.8, z_m: 0 },
    { x_m: x + 2.8, y_m: y + 2.8, z_m: 0 },
    { x_m: x - 2.8, y_m: y + 2.8, z_m: 0 },
  ];

  const hopperTop: VehiclePoint3D[] = [
    { x_m: x - 1.8, y_m: y - 1.8, z_m: 2.8 },
    { x_m: x + 1.8, y_m: y - 1.8, z_m: 2.8 },
    { x_m: x + 1.8, y_m: y + 1.8, z_m: 2.8 },
    { x_m: x - 1.8, y_m: y + 1.8, z_m: 2.8 },
  ];

  const hopperBottom: VehiclePoint3D[] = [
    { x_m: x - 0.7, y_m: y - 0.7, z_m: 0.5 },
    { x_m: x + 0.7, y_m: y - 0.7, z_m: 0.5 },
    { x_m: x + 0.7, y_m: y + 0.7, z_m: 0.5 },
    { x_m: x - 0.7, y_m: y + 0.7, z_m: 0.5 },
  ];

  const labelPoint = projectVehiclePointWithCamera(
    { x_m: x, y_m: y, z_m: 3.4 },
    camera,
  );

  return (
    <g aria-label="Crusher" className="crusher-plant-3d">
      <polygon
        points={polygon(pad, camera)}
        fill="#7b786d"
        stroke="#525048"
        strokeWidth="1.5"
      />
      <polygon
        points={polygon(
          [hopperTop[0], hopperTop[1], hopperBottom[1], hopperBottom[0]],
          camera,
        )}
        fill="#3c4749"
        stroke="#5a686b"
        strokeWidth="1.2"
      />
      <polygon
        points={polygon(
          [hopperTop[1], hopperTop[2], hopperBottom[2], hopperBottom[1]],
          camera,
        )}
        fill="#485658"
        stroke="#5a686b"
        strokeWidth="1.2"
      />
      <polygon
        points={polygon(
          [hopperTop[2], hopperTop[3], hopperBottom[3], hopperBottom[2]],
          camera,
        )}
        fill="#323b3d"
        stroke="#5a686b"
        strokeWidth="1.2"
      />
      <polygon
        points={polygon(
          [hopperTop[3], hopperTop[0], hopperBottom[0], hopperBottom[3]],
          camera,
        )}
        fill="#2a3335"
        stroke="#5a686b"
        strokeWidth="1.2"
      />
      <polygon
        points={polygon(hopperBottom, camera)}
        fill="#0a0f18"
        stroke="#1f2937"
        strokeWidth="1.5"
      />
      <polygon
        points={polygon(hopperTop, camera)}
        fill="none"
        stroke="#eab308"
        strokeWidth="3.5"
        strokeDasharray="14 10"
      />
      <g transform={`translate(${labelPoint.x}, ${labelPoint.y - 12})`}>
        <rect
          x="-62"
          y="-12"
          width="124"
          height="20"
          rx="5"
          fill="rgba(15, 23, 42, 0.94)"
          stroke="#38bdf8"
          strokeWidth="1.4"
          filter="drop-shadow(0 2px 8px rgba(0,0,0,0.5))"
        />
        <circle cx="-50" cy="-2" r="3.5" fill="#34d399" />
        <text
          x="6"
          y="2"
          textAnchor="middle"
          fill="#f8fafc"
          fontSize="9.5"
          fontWeight="800"
          fontFamily="var(--mono)"
          letterSpacing="0.04em"
        >
          CRUSHER RECEIVING BAY
        </text>
      </g>
    </g>
  );
}

/**
 * Rich 3D cascading iron ore chute and tumbling boulders pouring into the crusher.
 * Completely replaces the 6 flat dots with authentic heavy ore pouring geometry.
 */
function SpatialOreDumpAnimation({
  camera,
  dumpAngleDeg = 45,
}: {
  camera: CameraViewConfig;
  dumpAngleDeg?: number;
}) {
  const rad = ((dumpAngleDeg || 45) * Math.PI) / 180;
  const lipY = -1.41 - 0.05 * Math.cos(rad);
  const lipZ = 0.675 + 0.25 * Math.sin(rad);
  const hopperTargetY = -2.6;
  const hopperTargetZ = 0.2;

  const chuteRibbon = (
    xL0: number,
    xR0: number,
    xL1: number,
    xR1: number,
    y0: number,
    z0: number,
    y1: number,
    z1: number,
  ) => {
    const pts: VehiclePoint3D[] = [
      { x_m: xL0, y_m: y0, z_m: z0 },
      { x_m: xR0, y_m: y0, z_m: z0 },
      { x_m: xR1, y_m: y1, z_m: z1 },
      { x_m: xL1, y_m: y1, z_m: z1 },
    ];
    return polygon(pts, camera);
  };

  const rocks = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const startX = ((i % 3) - 1) * 0.24;
    const targetX = ((i % 3) - 1) * 0.38 + (i % 2 === 0 ? 0.08 : -0.08);
    const startPt = projectVehiclePointWithCamera(
      { x_m: startX, y_m: lipY, z_m: lipZ },
      camera,
    );
    const midPt = projectVehiclePointWithCamera(
      {
        x_m: (startX + targetX) * 0.5,
        y_m: (lipY + hopperTargetY) * 0.5,
        z_m: (lipZ + hopperTargetZ) * 0.5 + 0.15,
      },
      camera,
    );
    const endPt = projectVehiclePointWithCamera(
      { x_m: targetX, y_m: hopperTargetY, z_m: hopperTargetZ },
      camera,
    );
    return {
      i,
      startPt,
      midPt,
      endPt,
      r: 6 + (i % 3) * 2.5,
      delay: i * 0.18,
    };
  });

  const bannerPoint = projectVehiclePointWithCamera(
    { x_m: 0, y_m: -2.0, z_m: 1.8 },
    camera,
  );

  return (
    <g aria-label="Unloading ore at crusher" className="spatial-dumping-cascade">
      {/* Thick cascading 3D ore chute stream */}
      <polygon
        points={chuteRibbon(
          -0.55,
          0.55,
          -0.75,
          0.75,
          lipY,
          lipZ,
          hopperTargetY,
          hopperTargetZ,
        )}
        fill="#5a2217"
        stroke="#782e21"
        strokeWidth="1.5"
      />
      <polygon
        points={chuteRibbon(
          -0.35,
          0.35,
          -0.5,
          0.5,
          lipY + 0.05,
          lipZ - 0.05,
          hopperTargetY + 0.1,
          hopperTargetZ + 0.05,
        )}
        fill="#722b1f"
        opacity="0.9"
      />
      <polygon
        points={chuteRibbon(
          -0.18,
          0.18,
          -0.28,
          0.28,
          lipY + 0.08,
          lipZ - 0.08,
          hopperTargetY + 0.18,
          hopperTargetZ + 0.08,
        )}
        fill="#8a3727"
        opacity="0.85"
      />

      {/* 8 Tumbling 3D Rock Boulders crashing into hopper */}
      {rocks.map((rock) => (
        <g key={rock.i}>
          <polygon
            points={`-${rock.r},0 -${rock.r * 0.4},-${rock.r * 0.8} ${rock.r * 0.6},-${rock.r * 0.7} ${rock.r},${rock.r * 0.2} ${rock.r * 0.2},${rock.r * 0.8} -${rock.r * 0.7},${rock.r * 0.6}`}
            fill={rock.i % 2 === 0 ? "#6d291e" : "#551f15"}
            stroke="#8c3929"
            strokeWidth="1.2"
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              values={`${rock.startPt.x},${rock.startPt.y}; ${rock.midPt.x},${rock.midPt.y}; ${rock.endPt.x},${rock.endPt.y}`}
              dur="0.85s"
              begin={`${rock.delay}s`}
              repeatCount="indefinite"
            />
          </polygon>
        </g>
      ))}

      {/* Impact Dust Shockwave */}
      <ellipse
        cx={(rocks[0].endPt.x + rocks[2].endPt.x) * 0.5}
        cy={rocks[0].endPt.y}
        rx="22"
        ry="8"
        fill="rgba(120, 50, 30, 0.35)"
        stroke="#782e21"
        strokeWidth="1"
      >
        <animate
          attributeName="rx"
          values="12;28;12"
          dur="0.9s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.7;0.2;0.7"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </ellipse>

      {/* Floating Status Callout */}
      <g transform={`translate(${bannerPoint.x}, ${bannerPoint.y})`}>
        <rect
          x="-80"
          y="-12"
          width="160"
          height="22"
          rx="6"
          fill="rgba(8, 14, 24, 0.94)"
          stroke="#f59e0b"
          strokeWidth="1.4"
          filter="drop-shadow(0 4px 12px rgba(0,0,0,0.7))"
        />
        <circle
          cx="-68"
          cy="-1"
          r="4"
          fill="#f59e0b"
          className="pulse-danger-fast"
        />
        <text
          x="6"
          y="3"
          textAnchor="middle"
          fill="#fef3c7"
          fontSize="10"
          fontWeight="800"
          fontFamily="var(--mono)"
          letterSpacing="0.04em"
        >
          CRUSHER UNLOADING ACTIVE
        </text>
      </g>
    </g>
  );
}

export function HaulTraffic({
  world,
  vehicle,
  camera,
  children,
  dumpAngleDeg = 0,
}: {
  world: WorldState;
  vehicle: VehiclePose;
  camera: CameraViewConfig;
  children: ReactNode;
  dumpAngleDeg?: number;
}) {
  const entities = [
    {
      id: vehicle.vehicle_id,
      point: { x_m: 0, y_m: 0, z_m: 0 },
      node: children,
    },
  ];
  if (world.mode === "SIMULATED" && world.haul_route) {
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
          node: <CrusherPlant3D point={point} camera={camera} />,
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
    const reportedObstacle = world.haul_route.obstacle;
    const fallbackObstacle = demoRockPoint(world);
    const obstacle = reportedObstacle ?? fallbackObstacle;
    const obstacleDetected = reportedObstacle
      ? world.haul_route.obstacle_detected
      : Boolean(fallbackObstacle);
    if (obstacle && obstacleDetected) {
      const point = localPoint(obstacle, vehicle);
      if (Math.hypot(point.x_m, point.y_m) <= 14)
        entities.push({
          id: "road-obstruction",
          point,
          node: (
            <RoadObstacle
              point={point}
              radius={reportedObstacle ? world.haul_route.obstacle_radius_m : 0.45}
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
      {world.mode === "SIMULATED" &&
        world.haul_route?.phase === "ARRIVED" &&
        world.haul_route.destination === "Dump point" && (
          <SpatialOreDumpAnimation
            camera={camera}
            dumpAngleDeg={dumpAngleDeg}
          />
        )}
    </>
  );
}
