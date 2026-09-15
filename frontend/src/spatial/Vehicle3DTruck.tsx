import { useId, useMemo } from "react";
import {
  buildTruckMesh,
  surfaceNormal,
  DUMP_BED_PARTS,
  TRUCK_HINGE_Y_M,
  TRUCK_HINGE_Z_M,
} from "./truckMesh";
import type { RangeReading } from "../types";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import {
  applyImuTransform,
  cameraDepthForVehiclePoint,
  getSensorThreatLevel,
  projectVehiclePointWithCamera,
  rangeEndpoint,
  type CameraViewConfig,
  type ImuOrientation,
  type ThreatLevel,
  type VehiclePoint3D,
} from "./spatialProjection";

interface Vehicle3DTruckProps {
  sensors: SensorDisplaySetting[];
  readings: RangeReading[];
  emergencyState?: string;
  isPrimary?: boolean;
  callsign?: string;
  showSensorMounts?: boolean;
  showHeadlightBeams?: boolean;
  showPerimeterShield?: boolean;
  activeAlertSensorId?: string | null;
  imuOrientation?: ImuOrientation;
  steerAngleDeg?: number;
  dumpAngleDeg?: number;
  oreLevel?: number;
  cameraConfig?: CameraViewConfig;
  sceneOffset?: VehiclePoint3D;
}

function sensorClass(sensorId: string): string {
  return `sensor-${sensorId.replaceAll("_", "-")}`;
}

export function Vehicle3DTruck({
  sensors,
  readings,
  emergencyState = "SAFE",
  isPrimary = true,
  callsign = "DUMPER_01",
  showSensorMounts = true,
  showHeadlightBeams = true,
  showPerimeterShield = true,
  activeAlertSensorId,
  imuOrientation = { pitch_deg: 0, roll_deg: 0, yaw_deg: 0, suspension_z_m: 0 },
  steerAngleDeg = 0,
  dumpAngleDeg = 0,
  oreLevel = 1.0,
  cameraConfig = {},
  sceneOffset = { x_m: 0, y_m: 0, z_m: 0 },
}: Vehicle3DTruckProps) {
  const id = useId();
  const offset = (p: VehiclePoint3D) => ({
    x_m: p.x_m + sceneOffset.x_m,
    y_m: p.y_m + sceneOffset.y_m,
    z_m: p.z_m + sceneOffset.z_m,
  });
  const readingById = new Map(readings.map((r) => [r.sensor_id, r]));

  // Threat levels per sensor
  const threatBySensor = new Map<string, ThreatLevel>(
    sensors.map((s) => [
      s.sensor_id,
      getSensorThreatLevel(readingById.get(s.sensor_id), s),
    ]),
  );

  const hasAnyAlert =
    emergencyState !== "SAFE" ||
    Array.from(threatBySensor.values()).some((threat) => threat === "ALERT");
  const isFrontAlert =
    threatBySensor.get("front_scanner") === "ALERT" ||
    threatBySensor.get("front_fixed") === "ALERT";
  const isRearAlert = threatBySensor.get("rear_scanner") === "ALERT";
  const isLeftAlert = threatBySensor.get("left_side") === "ALERT";
  const isRightAlert = threatBySensor.get("right_side") === "ALERT";

  // 3D Point Transform Helper:
  // 1. Applies MPU-6050 pitch/roll/yaw/suspension transform
  // 2. Projects with perspective camera configuration
  const transformPoint = (p: VehiclePoint3D): VehiclePoint3D =>
    offset(applyImuTransform(p, imuOrientation));

  const proj = (p: VehiclePoint3D) =>
    projectVehiclePointWithCamera(transformPoint(p), cameraConfig);

  const projGround = (p: VehiclePoint3D) =>
    projectVehiclePointWithCamera(
      offset(
        applyImuTransform(p, { ...imuOrientation, pitch_deg: 0, roll_deg: 0 }),
      ),
      cameraConfig,
    );

  const poly = (points: VehiclePoint3D[]): string =>
    points
      .map((p) => {
        const screen = proj(p);
        return `${screen.x.toFixed(1)},${screen.y.toFixed(1)}`;
      })
      .join(" ");

  const polyGround = (points: VehiclePoint3D[]): string =>
    points
      .map((p) => {
        const screen = projGround(p);
        return `${screen.x.toFixed(1)},${screen.y.toFixed(1)}`;
      })
      .join(" ");

  const tiltDumpPoint = (p: VehiclePoint3D): VehiclePoint3D => {
    if (!dumpAngleDeg) return p;
    const rad = (dumpAngleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dy = p.y_m - TRUCK_HINGE_Y_M;
    const dz = p.z_m - TRUCK_HINGE_Z_M;
    return {
      x_m: p.x_m,
      y_m: TRUCK_HINGE_Y_M + (dy * cos - dz * sin),
      z_m: TRUCK_HINGE_Z_M + (dy * sin + dz * cos),
    };
  };

  const mesh = useMemo(() => buildTruckMesh(steerAngleDeg), [steerAngleDeg]);
  const modelFaces = useMemo(() => {
    const allSurfaces = [...mesh];
    if (dumpAngleDeg > 2) {
      for (const side of [-1, 1]) {
        const x = 0.28 * side;
        const base: VehiclePoint3D = { x_m: x, y_m: 0.15, z_m: 0.42 };
        const top = tiltDumpPoint({ x_m: x, y_m: 0.15, z_m: 0.65 });
        const w = 0.04;
        allSurfaces.push({
          key: `hydraulic-ram-${side}`,
          part: "truck-hydraulic-ram",
          points: [
            { x_m: x - w, y_m: base.y_m, z_m: base.z_m },
            { x_m: x + w, y_m: base.y_m, z_m: base.z_m },
            { x_m: x + w, y_m: top.y_m, z_m: top.z_m },
            { x_m: x - w, y_m: top.y_m, z_m: top.z_m },
          ],
          fill: "#a8b5ba",
          details: [],
        });
      }
    }

    return allSurfaces
      .flatMap((surface) => {
        if (surface.part === "truck-ore-cargo" && oreLevel <= 0.04) {
          return [];
        }
        const rawPoints = surface.points.map((p) => {
          if (surface.part.startsWith("truck-hydraulic-ram")) {
            return p;
          }
          if (DUMP_BED_PARTS.has(surface.part)) {
            if (surface.part === "truck-ore-cargo" && dumpAngleDeg > 18) {
              const slide = Math.min(0.85, (dumpAngleDeg - 18) * 0.022);
              return tiltDumpPoint({
                x_m: p.x_m,
                y_m: p.y_m - slide,
                z_m: p.z_m * Math.max(0.1, oreLevel),
              });
            }
            return tiltDumpPoint(p);
          }
          return p;
        });

        const points = rawPoints.map((p) =>
          offset(applyImuTransform(p, imuOrientation)),
        );
        if (
          cameraDepthForVehiclePoint(surfaceNormal(points), cameraConfig) >=
          -0.00001
        )
          return [];
        const project = (vertices: VehiclePoint3D[]) =>
          vertices
            .map((p) => {
              const screen = projectVehiclePointWithCamera(p, cameraConfig);
              return `${screen.x.toFixed(2)},${screen.y.toFixed(2)}`;
            })
            .join(" ");
        return [
          {
            ...surface,
            depth:
              points.reduce(
                (sum, p) => sum + cameraDepthForVehiclePoint(p, cameraConfig),
                0,
              ) / points.length,
            polygon: project(points),
            details: surface.details.map((d) => ({
              fill: d.fill,
              polygon: project(
                d.points
                  .map((p) =>
                    DUMP_BED_PARTS.has(surface.part) ? tiltDumpPoint(p) : p,
                  )
                  .map((p) => offset(applyImuTransform(p, imuOrientation))),
              ),
            })),
          },
        ];
      })
      .sort((a, b) => b.depth - a.depth);
  }, [
    mesh,
    dumpAngleDeg,
    oreLevel,
    imuOrientation.pitch_deg,
    imuOrientation.roll_deg,
    imuOrientation.yaw_deg,
    imuOrientation.suspension_z_m,
    cameraConfig.orbitYawDeg,
    cameraConfig.cameraPitchDeg,
    cameraConfig.zoomScale,
    cameraConfig.panOffsetX,
    cameraConfig.panOffsetY,
    sceneOffset.x_m,
    sceneOffset.y_m,
    sceneOffset.z_m,
  ]);

  // Range updates do not change the body mesh. Reuse its element tree as well
  // as its projected geometry, while keeping the alert beacon responsive.
  const modelBody = useMemo(() => (
    <g
      className="truck-model-surfaces"
      strokeLinejoin="round"
      aria-label="Mining dumper body"
    >
      {modelFaces.map((surface) => (
        <g
          key={surface.key}
          data-part={surface.part}
          className={surface.part.startsWith("wheel-")
            ? "truck-wheels truck-tire-assembly"
            : surface.part}
        >
          <polygon
            className={surface.part.startsWith("wheel-")
              ? "truck-tire-face"
              : surface.part === "truck-beacon-lens" && hasAnyAlert
                ? "truck-body-face beacon-pulse-alert"
                : "truck-body-face"}
            points={surface.polygon}
            fill={surface.part === "truck-beacon-lens" && hasAnyAlert
              ? "#ef4444" : surface.fill}
            stroke={surface.part === "truck-beacon-lens" && hasAnyAlert
              ? "#ef4444" : surface.fill}
            strokeWidth="0.4"
          />
          {surface.details.map((detail, index) => (
            <polygon key={index} points={detail.polygon} fill={detail.fill} />
          ))}
        </g>
      ))}
    </g>
  ), [modelFaces, hasAnyAlert]);

  // Ground Contact & Shadow Coordinates (Grounded on z = 0)
  const shadowPoints: VehiclePoint3D[] = [
    { x_m: -0.82, y_m: 1.28, z_m: 0 },
    { x_m: 0.82, y_m: 1.28, z_m: 0 },
    { x_m: 0.88, y_m: -1.48, z_m: 0 },
    { x_m: -0.88, y_m: -1.48, z_m: 0 },
  ];

  // Headlight illumination cones projected on the ground
  const leftLightCone: VehiclePoint3D[] = [
    { x_m: -0.48, y_m: 1.15, z_m: 0.02 },
    { x_m: -1.15, y_m: 3.4, z_m: 0.02 },
    { x_m: -0.15, y_m: 3.6, z_m: 0.02 },
  ];
  const rightLightCone: VehiclePoint3D[] = [
    { x_m: 0.48, y_m: 1.15, z_m: 0.02 },
    { x_m: 0.15, y_m: 3.6, z_m: 0.02 },
    { x_m: 1.15, y_m: 3.4, z_m: 0.02 },
  ];

  // Perimeter Hazard Shields on Ground (z = 0)
  const frontShield: VehiclePoint3D[] = [
    { x_m: -0.95, y_m: 1.15, z_m: 0.01 },
    { x_m: -0.75, y_m: 1.75, z_m: 0.01 },
    { x_m: 0.75, y_m: 1.75, z_m: 0.01 },
    { x_m: 0.95, y_m: 1.15, z_m: 0.01 },
  ];
  const rearShield: VehiclePoint3D[] = [
    { x_m: -0.95, y_m: -1.35, z_m: 0.01 },
    { x_m: -0.75, y_m: -1.95, z_m: 0.01 },
    { x_m: 0.75, y_m: -1.95, z_m: 0.01 },
    { x_m: 0.95, y_m: -1.35, z_m: 0.01 },
  ];
  const leftShield: VehiclePoint3D[] = [
    { x_m: -0.85, y_m: 1.1, z_m: 0.01 },
    { x_m: -1.45, y_m: 0.7, z_m: 0.01 },
    { x_m: -1.45, y_m: -1.1, z_m: 0.01 },
    { x_m: -0.85, y_m: -1.35, z_m: 0.01 },
  ];
  const rightShield: VehiclePoint3D[] = [
    { x_m: 0.85, y_m: 1.1, z_m: 0.01 },
    { x_m: 1.45, y_m: 0.7, z_m: 0.01 },
    { x_m: 1.45, y_m: -1.1, z_m: 0.01 },
    { x_m: 0.85, y_m: -1.35, z_m: 0.01 },
  ];

  const callsignPos: VehiclePoint3D = { x_m: 0, y_m: 0, z_m: 1.78 };
  const callsignScreen = proj(callsignPos);

  return (
    <g
      className={`vehicle-3d-truck ${hasAnyAlert ? "truck-alert-active" : ""}`}
      aria-label={`${callsign} 3D model`}
    >
      <defs>
        <radialGradient
          id={`${id}-headlight`}
          cx="0"
          cy="0"
          r="100%"
          fx="0"
          fy="0"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="35%" stopColor="#38bdf8" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={`${id}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.75" />
          <stop offset="60%" stopColor="#000000" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={`${id}-hazard`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Ground Shadow */}
      <polygon
        points={polyGround(shadowPoints)}
        fill={`url(#${id}-shadow)`}
        className="truck-ground-shadow"
      />

      {/* Headlight Light Cones onto Ground */}
      {showHeadlightBeams && (
        <g className="headlight-illumination" aria-hidden="true">
          <polygon
            points={poly(leftLightCone)}
            fill={`url(#${id}-headlight)`}
          />
          <polygon
            points={poly(rightLightCone)}
            fill={`url(#${id}-headlight)`}
          />
        </g>
      )}

      {/* Perimeter Warning Shields */}
      {showPerimeterShield && (
        <g className="perimeter-hazard-shields">
          {isFrontAlert && (
            <polygon
              points={polyGround(frontShield)}
              fill={`url(#${id}-hazard)`}
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield front-shield pulse-danger-fast"
            />
          )}
          {isRearAlert && (
            <polygon
              points={polyGround(rearShield)}
              fill={`url(#${id}-hazard)`}
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield rear-shield pulse-danger-fast"
            />
          )}
          {isLeftAlert && (
            <polygon
              points={polyGround(leftShield)}
              fill={`url(#${id}-hazard)`}
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield left-shield pulse-danger-fast"
            />
          )}
          {isRightAlert && (
            <polygon
              points={polyGround(rightShield)}
              fill={`url(#${id}-hazard)`}
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield right-shield pulse-danger-fast"
            />
          )}
        </g>
      )}

      {modelBody}

      {/* Mounted Sensor Pods */}
      {showSensorMounts && (
        <g className="truck-sensor-mounts">
          {sensors.map((sensor) => {
            const reading = readingById.get(sensor.sensor_id);
            const hasFiniteReturn = Boolean(
              reading?.is_valid && Number.isFinite(reading.range_m),
            );
            const origin = proj(sensor.display_pose);
            const endpoint = proj(rangeEndpoint(sensor, reading));
            const threat = threatBySensor.get(sensor.sensor_id) ?? "UNKNOWN";
            const isAlert =
              threat === "ALERT" || activeAlertSensorId === sensor.sensor_id;
            const isCaution = threat === "CAUTION";
            const isUnknown = threat === "UNKNOWN";

            const podColor = isAlert
              ? "#ef4444"
              : isCaution
                ? "#f59e0b"
                : isUnknown
                  ? "#94a3b8"
                  : `var(--${sensorClass(sensor.sensor_id)}, #38bdf8)`;

            return (
              <g
                key={sensor.sensor_id}
                className={`sensor-pod-3d ${sensorClass(sensor.sensor_id)} ${isAlert ? "sensor-pod-alert" : ""} ${isUnknown ? "sensor-pod-unknown" : ""}`}
              >
                <line
                  x1={origin.x}
                  y1={origin.y}
                  x2={origin.x + (endpoint.x - origin.x) * 0.15}
                  y2={origin.y + (endpoint.y - origin.y) * 0.15}
                  stroke={podColor}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <circle
                  cx={origin.x}
                  cy={origin.y}
                  r={sensor.scanner ? 7 : 5.5}
                  fill="#0f172a"
                  stroke={podColor}
                  strokeWidth="2"
                />
                <circle
                  cx={origin.x}
                  cy={origin.y}
                  r={sensor.scanner ? 3.8 : 2.8}
                  fill={podColor}
                  className={isAlert ? "sensor-lens-alert" : ""}
                />
                {isAlert && (
                  <circle
                    cx={origin.x}
                    cy={origin.y}
                    r="12"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="1.5"
                    className="sensor-alert-ring"
                  />
                )}
                <title>{`${sensor.label}: ${threat} (${hasFiniteReturn ? `${reading!.range_m.toFixed(2)} m` : "no return"})`}</title>
              </g>
            );
          })}
        </g>
      )}

      {/* Floating Callsign Tag */}
      <g
        className="truck-callsign-hud"
        transform={`translate(${callsignScreen.x}, ${callsignScreen.y})`}
      >
        <rect
          x="-48"
          y="-14"
          width="96"
          height="18"
          rx="5"
          fill="rgba(3, 7, 18, 0.94)"
          stroke={
            hasAnyAlert
              ? "#ef4444"
              : isPrimary
                ? "var(--accent, #38bdf8)"
                : "#94a3b8"
          }
          strokeWidth="1.5"
          filter="drop-shadow(0 2px 8px rgba(0,0,0,0.6))"
        />
        <circle
          cx="-38"
          cy="-5"
          r="3.5"
          fill={hasAnyAlert ? "#ef4444" : "#4ade80"}
          className={hasAnyAlert ? "pulse-danger-fast" : ""}
        />
        <text
          x="4"
          y="-1"
          textAnchor="middle"
          fontSize="9.5"
          fill="#f8fafc"
          fontWeight="800"
          fontFamily="var(--mono, monospace)"
          letterSpacing="0.06em"
        >
          {callsign}
        </text>
      </g>
    </g>
  );
}
