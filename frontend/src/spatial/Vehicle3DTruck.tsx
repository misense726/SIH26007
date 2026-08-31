import type { RangeReading } from "../types";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import {
  applyImuTransform,
  cameraDepthForVehiclePoint,
  DEFAULT_CAMERA_PITCH_DEG,
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
  cameraConfig?: CameraViewConfig;
}

interface TruckFace {
  key: string;
  points: VehiclePoint3D[];
  fill: string;
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
  cameraConfig = {},
}: Vehicle3DTruckProps) {
  const readingById = new Map(readings.map((r) => [r.sensor_id, r]));

  // Threat levels per sensor
  const threatBySensor = new Map<string, ThreatLevel>(
    sensors.map((s) => [s.sensor_id, getSensorThreatLevel(readingById.get(s.sensor_id), s)]),
  );

  const hasAnyAlert =
    emergencyState !== "SAFE" ||
    Array.from(threatBySensor.values()).some((threat) => threat === "ALERT");
  const isUndersideView =
    (cameraConfig.cameraPitchDeg ?? DEFAULT_CAMERA_PITCH_DEG) < 0;

  const isFrontAlert =
    threatBySensor.get("front_scanner") === "ALERT" ||
    threatBySensor.get("front_fixed") === "ALERT";
  const isRearAlert = threatBySensor.get("rear_scanner") === "ALERT";
  const isLeftAlert = threatBySensor.get("left_side") === "ALERT";
  const isRightAlert = threatBySensor.get("right_side") === "ALERT";

  // -------------------------------------------------------------
  // 3D Point Transform Helper:
  // 1. Applies MPU-6050 pitch/roll/yaw/suspension transform
  // 2. Projects with perspective camera configuration
  // -------------------------------------------------------------
  const transformPoint = (p: VehiclePoint3D): VehiclePoint3D =>
    applyImuTransform(p, imuOrientation);

  const proj = (p: VehiclePoint3D) =>
    projectVehiclePointWithCamera(transformPoint(p), cameraConfig);

  const projGround = (p: VehiclePoint3D) =>
    projectVehiclePointWithCamera(p, cameraConfig);

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

  const faceDepth = (face: TruckFace): number =>
    face.points.reduce(
      (sum, point) =>
        sum + cameraDepthForVehiclePoint(transformPoint(point), cameraConfig),
      0,
    ) / face.points.length;

  const backToFront = (faces: TruckFace[]): TruckFace[] =>
    [...faces].sort((a, b) => faceDepth(b) - faceDepth(a));

  // -------------------------------------------------------------
  // Ground Contact & Shadow Coordinates (Grounded on z = 0)
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // Perimeter Hazard Shields on Ground (z = 0)
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // 3D Wheels & Tires with Front Steering Geometry
  // -------------------------------------------------------------
  const buildTire = (
    centerX: number,
    centerY: number,
    width: number = 0.22,
    radius: number = 0.32,
    steerAngle: number = 0,
  ) => {
    const halfW = width / 2;
    const zBase = 0.01;
    const zTop = radius * 2;
    const length = 0.34;

    const xOuter = centerX < 0 ? centerX - halfW : centerX + halfW;
    const xInner = centerX < 0 ? centerX + halfW : centerX - halfW;

    // Local steer rotation around (centerX, centerY)
    const steerRad = (steerAngle * Math.PI) / 180;
    const steer = (x: number, y: number, z: number): VehiclePoint3D => {
      if (steerAngle === 0) return { x_m: x, y_m: y, z_m: z };
      const dx = x - centerX;
      const dy = y - centerY;
      return {
        x_m: centerX + dx * Math.cos(steerRad) + dy * Math.sin(steerRad),
        y_m: centerY - dx * Math.sin(steerRad) + dy * Math.cos(steerRad),
        z_m: z,
      };
    };

    const innerRearBottom = steer(xInner, centerY - length, zBase);
    const innerFrontBottom = steer(xInner, centerY + length, zBase);
    const innerRearTop = steer(xInner, centerY - length, zTop);
    const innerFrontTop = steer(xInner, centerY + length, zTop);
    const outerRearBottom = steer(xOuter, centerY - length, zBase);
    const outerFrontBottom = steer(xOuter, centerY + length, zBase);
    const outerRearTop = steer(xOuter, centerY - length, zTop);
    const outerFrontTop = steer(xOuter, centerY + length, zTop);

    const faces: TruckFace[] = [
      {
        key: "inner",
        points: [innerRearBottom, innerFrontBottom, innerFrontTop, innerRearTop],
        fill: "#070b12",
      },
      {
        key: "outer",
        points: [outerRearBottom, outerFrontBottom, outerFrontTop, outerRearTop],
        fill: "#090d14",
      },
      {
        key: "top",
        points: [innerRearTop, innerFrontTop, outerFrontTop, outerRearTop],
        fill: "#253247",
      },
      {
        key: "bottom",
        points: [innerRearBottom, innerFrontBottom, outerFrontBottom, outerRearBottom],
        fill: "#05080d",
      },
      {
        key: "front",
        points: [innerFrontBottom, outerFrontBottom, outerFrontTop, innerFrontTop],
        fill: "#111827",
      },
      {
        key: "rear",
        points: [innerRearBottom, outerRearBottom, outerRearTop, innerRearTop],
        fill: "#0b111c",
      },
    ];

    const hubCenter: VehiclePoint3D = steer(xOuter, centerY, radius);

    return { faces, hubCenter };
  };

  const frontLeftWheel = buildTire(-0.66, 0.72, 0.22, 0.30, steerAngleDeg);
  const frontRightWheel = buildTire(0.66, 0.72, 0.22, 0.30, steerAngleDeg);
  const rearLeftOuterWheel = buildTire(-0.70, -0.72, 0.20, 0.34, 0);
  const rearLeftInnerWheel = buildTire(-0.46, -0.72, 0.18, 0.34, 0);
  const rearRightOuterWheel = buildTire(0.70, -0.72, 0.20, 0.34, 0);
  const rearRightInnerWheel = buildTire(0.46, -0.72, 0.18, 0.34, 0);

  // -------------------------------------------------------------
  // Chassis & Undercarriage Frame
  // -------------------------------------------------------------
  const chassisBottomLeft: VehiclePoint3D = { x_m: -0.45, y_m: -1.35, z_m: 0.26 };
  const chassisBottomRight: VehiclePoint3D = { x_m: 0.45, y_m: -1.35, z_m: 0.26 };
  const chassisFrontLeft: VehiclePoint3D = { x_m: -0.45, y_m: 1.15, z_m: 0.26 };
  const chassisFrontRight: VehiclePoint3D = { x_m: 0.45, y_m: 1.15, z_m: 0.26 };

  const underbodySkidPlate: VehiclePoint3D[] = [
    { x_m: -0.38, y_m: -1.18, z_m: 0.12 },
    { x_m: 0.38, y_m: -1.18, z_m: 0.12 },
    { x_m: 0.38, y_m: 1.02, z_m: 0.12 },
    { x_m: -0.38, y_m: 1.02, z_m: 0.12 },
  ];
  const underbodyDriveShaft: VehiclePoint3D[] = [
    { x_m: -0.07, y_m: -0.82, z_m: 0.08 },
    { x_m: 0.07, y_m: -0.82, z_m: 0.08 },
    { x_m: 0.07, y_m: 0.82, z_m: 0.08 },
    { x_m: -0.07, y_m: 0.82, z_m: 0.08 },
  ];
  const underbodyGearbox: VehiclePoint3D[] = [
    { x_m: -0.25, y_m: -0.38, z_m: 0.06 },
    { x_m: 0.25, y_m: -0.38, z_m: 0.06 },
    { x_m: 0.22, y_m: 0.28, z_m: 0.06 },
    { x_m: -0.22, y_m: 0.28, z_m: 0.06 },
  ];
  const axlePlate = (centerY: number): VehiclePoint3D[] => [
    { x_m: -0.78, y_m: centerY - 0.08, z_m: 0.16 },
    { x_m: 0.78, y_m: centerY - 0.08, z_m: 0.16 },
    { x_m: 0.78, y_m: centerY + 0.08, z_m: 0.16 },
    { x_m: -0.78, y_m: centerY + 0.08, z_m: 0.16 },
  ];
  const frontAxle = axlePlate(0.72);
  const rearAxle = axlePlate(-0.72);

  const coreRearLower: VehiclePoint3D[] = [
    { x_m: -0.48, y_m: -1.30, z_m: 0.18 },
    { x_m: 0.48, y_m: -1.30, z_m: 0.18 },
  ];
  const coreFrontLower: VehiclePoint3D[] = [
    { x_m: -0.48, y_m: 1.08, z_m: 0.18 },
    { x_m: 0.48, y_m: 1.08, z_m: 0.18 },
  ];
  const coreRearUpper: VehiclePoint3D[] = [
    { x_m: -0.48, y_m: -1.30, z_m: 0.54 },
    { x_m: 0.48, y_m: -1.30, z_m: 0.54 },
  ];
  const coreFrontUpper: VehiclePoint3D[] = [
    { x_m: -0.48, y_m: 1.08, z_m: 0.54 },
    { x_m: 0.48, y_m: 1.08, z_m: 0.54 },
  ];
  const solidCoreFaces: TruckFace[] = [
    {
      key: "bottom",
      points: [coreRearLower[0], coreRearLower[1], coreFrontLower[1], coreFrontLower[0]],
      fill: "#080d16",
    },
    {
      key: "top",
      points: [coreRearUpper[0], coreRearUpper[1], coreFrontUpper[1], coreFrontUpper[0]],
      fill: "#263449",
    },
    {
      key: "left",
      points: [coreRearLower[0], coreFrontLower[0], coreFrontUpper[0], coreRearUpper[0]],
      fill: "#101827",
    },
    {
      key: "right",
      points: [coreRearLower[1], coreFrontLower[1], coreFrontUpper[1], coreRearUpper[1]],
      fill: "#172235",
    },
    {
      key: "front",
      points: [coreFrontLower[0], coreFrontLower[1], coreFrontUpper[1], coreFrontUpper[0]],
      fill: "#1d2a3d",
    },
    {
      key: "rear",
      points: [coreRearLower[0], coreRearLower[1], coreRearUpper[1], coreRearUpper[0]],
      fill: "#0b121e",
    },
  ];

  // -------------------------------------------------------------
  // Dump Bed / Hopper Body
  // -------------------------------------------------------------
  const bedFloor: VehiclePoint3D[] = [
    { x_m: -0.58, y_m: -1.35, z_m: 0.50 },
    { x_m: 0.58, y_m: -1.35, z_m: 0.50 },
    { x_m: 0.58, y_m: 0.46, z_m: 0.50 },
    { x_m: -0.58, y_m: 0.46, z_m: 0.50 },
  ];

  const bedLeftWall: VehiclePoint3D[] = [
    { x_m: -0.58, y_m: -1.35, z_m: 0.50 },
    { x_m: -0.58, y_m: 0.46, z_m: 0.50 },
    { x_m: -0.76, y_m: 0.46, z_m: 1.16 },
    { x_m: -0.76, y_m: -1.35, z_m: 1.16 },
  ];

  const bedRightWall: VehiclePoint3D[] = [
    { x_m: 0.58, y_m: -1.35, z_m: 0.50 },
    { x_m: 0.58, y_m: 0.46, z_m: 0.50 },
    { x_m: 0.76, y_m: 0.46, z_m: 1.16 },
    { x_m: 0.76, y_m: -1.35, z_m: 1.16 },
  ];

  const bedFrontWall: VehiclePoint3D[] = [
    { x_m: -0.76, y_m: 0.46, z_m: 0.50 },
    { x_m: 0.76, y_m: 0.46, z_m: 0.50 },
    { x_m: 0.76, y_m: 0.46, z_m: 1.16 },
    { x_m: -0.76, y_m: 0.46, z_m: 1.16 },
  ];

  const bedCanopy: VehiclePoint3D[] = [
    { x_m: -0.76, y_m: 0.46, z_m: 1.16 },
    { x_m: 0.76, y_m: 0.46, z_m: 1.16 },
    { x_m: 0.68, y_m: 0.90, z_m: 1.28 },
    { x_m: -0.68, y_m: 0.90, z_m: 1.28 },
  ];

  const bedTailgate: VehiclePoint3D[] = [
    { x_m: -0.58, y_m: -1.35, z_m: 0.50 },
    { x_m: 0.58, y_m: -1.35, z_m: 0.50 },
    { x_m: 0.76, y_m: -1.35, z_m: 1.16 },
    { x_m: -0.76, y_m: -1.35, z_m: 1.16 },
  ];

  // -------------------------------------------------------------
  // Operator Cab & Panoramic Windshield
  // -------------------------------------------------------------
  const cabBase: VehiclePoint3D[] = [
    { x_m: -0.54, y_m: 0.52, z_m: 0.48 },
    { x_m: 0.18, y_m: 0.52, z_m: 0.48 },
    { x_m: 0.18, y_m: 1.06, z_m: 0.48 },
    { x_m: -0.54, y_m: 1.06, z_m: 0.48 },
  ];

  const cabRoof: VehiclePoint3D[] = [
    { x_m: -0.52, y_m: 0.54, z_m: 1.15 },
    { x_m: 0.16, y_m: 0.54, z_m: 1.15 },
    { x_m: 0.16, y_m: 0.86, z_m: 1.15 },
    { x_m: -0.52, y_m: 0.86, z_m: 1.15 },
  ];

  const windshield: VehiclePoint3D[] = [
    { x_m: -0.52, y_m: 1.04, z_m: 0.68 },
    { x_m: 0.16, y_m: 1.04, z_m: 0.68 },
    { x_m: 0.16, y_m: 0.86, z_m: 1.15 },
    { x_m: -0.52, y_m: 0.86, z_m: 1.15 },
  ];

  const cabLeftWindow: VehiclePoint3D[] = [
    { x_m: -0.54, y_m: 0.56, z_m: 0.72 },
    { x_m: -0.54, y_m: 0.98, z_m: 0.72 },
    { x_m: -0.52, y_m: 0.86, z_m: 1.12 },
    { x_m: -0.52, y_m: 0.56, z_m: 1.12 },
  ];

  const deckBox: VehiclePoint3D[] = [
    { x_m: 0.20, y_m: 0.52, z_m: 0.48 },
    { x_m: 0.56, y_m: 0.52, z_m: 0.48 },
    { x_m: 0.56, y_m: 1.06, z_m: 0.48 },
    { x_m: 0.20, y_m: 1.06, z_m: 0.48 },
  ];
  const deckBoxTop: VehiclePoint3D[] = [
    { x_m: 0.20, y_m: 0.52, z_m: 0.78 },
    { x_m: 0.56, y_m: 0.52, z_m: 0.78 },
    { x_m: 0.56, y_m: 1.06, z_m: 0.78 },
    { x_m: 0.20, y_m: 1.06, z_m: 0.78 },
  ];

  // -------------------------------------------------------------
  // Front Bumper & Grille
  // -------------------------------------------------------------
  const frontBumper: VehiclePoint3D[] = [
    { x_m: -0.68, y_m: 1.14, z_m: 0.22 },
    { x_m: 0.68, y_m: 1.14, z_m: 0.22 },
    { x_m: 0.68, y_m: 1.14, z_m: 0.48 },
    { x_m: -0.68, y_m: 1.14, z_m: 0.48 },
  ];

  const frontGrille: VehiclePoint3D[] = [
    { x_m: -0.48, y_m: 1.08, z_m: 0.48 },
    { x_m: 0.48, y_m: 1.08, z_m: 0.48 },
    { x_m: 0.48, y_m: 1.08, z_m: 0.68 },
    { x_m: -0.48, y_m: 1.08, z_m: 0.68 },
  ];

  // Headlights & Beacon
  const leftHeadlightPos: VehiclePoint3D = { x_m: -0.52, y_m: 1.14, z_m: 0.38 };
  const rightHeadlightPos: VehiclePoint3D = { x_m: 0.52, y_m: 1.14, z_m: 0.38 };
  const leftLightScreen = proj(leftHeadlightPos);
  const rightLightScreen = proj(rightHeadlightPos);

  const beaconPos: VehiclePoint3D = { x_m: -0.18, y_m: 0.70, z_m: 1.24 };
  const beaconScreen = proj(beaconPos);

  const callsignPos: VehiclePoint3D = { x_m: 0, y_m: 0, z_m: 1.65 };
  const callsignScreen = proj(callsignPos);

  return (
    <g className={`vehicle-3d-truck ${hasAnyAlert ? "truck-alert-active" : ""}`} aria-label={`${callsign} 3D model`}>
      <defs>
        <linearGradient id="truck-metal-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent, #38bdf8)" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>

        <linearGradient id="truck-chassis" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#090d16" />
          <stop offset="50%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#090d16" />
        </linearGradient>

        <linearGradient id="truck-windshield-glass" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#0284c7" stopOpacity="0.75" />
          <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#bae6fd" stopOpacity="0.85" />
        </linearGradient>

        <linearGradient id="truck-bed-hopper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="40%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>

        <radialGradient id="headlight-beam-glow" cx="0" cy="0" r="100%" fx="0" fy="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="35%" stopColor="#38bdf8" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="ground-ao-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.75" />
          <stop offset="60%" stopColor="#000000" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="hazard-perimeter-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* 1. Ground Shadow */}
      <polygon
        points={polyGround(shadowPoints)}
        fill="url(#ground-ao-shadow)"
        className="truck-ground-shadow"
      />

      {/* 2. Headlight Light Cones onto Ground */}
      {showHeadlightBeams && (
        <g className="headlight-illumination" aria-hidden="true">
          <polygon points={poly(leftLightCone)} fill="url(#headlight-beam-glow)" />
          <polygon points={poly(rightLightCone)} fill="url(#headlight-beam-glow)" />
        </g>
      )}

      {/* 3. Perimeter Warning Shields */}
      {showPerimeterShield && (
        <g className="perimeter-hazard-shields">
          {isFrontAlert && (
            <polygon
              points={polyGround(frontShield)}
              fill="url(#hazard-perimeter-red)"
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield front-shield pulse-danger-fast"
            />
          )}
          {isRearAlert && (
            <polygon
              points={polyGround(rearShield)}
              fill="url(#hazard-perimeter-red)"
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield rear-shield pulse-danger-fast"
            />
          )}
          {isLeftAlert && (
            <polygon
              points={polyGround(leftShield)}
              fill="url(#hazard-perimeter-red)"
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield left-shield pulse-danger-fast"
            />
          )}
          {isRightAlert && (
            <polygon
              points={polyGround(rightShield)}
              fill="url(#hazard-perimeter-red)"
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              className="perimeter-shield right-shield pulse-danger-fast"
            />
          )}
        </g>
      )}

      {/* Closed load-bearing chassis core remains solid from every camera angle. */}
      <g className="truck-solid-core" aria-label="Solid truck chassis">
        {backToFront(solidCoreFaces).map((face) => (
          <polygon
            key={`core-${face.key}`}
            className="truck-core-face"
            points={poly(face.points)}
            fill={face.fill}
            stroke="#526176"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
        ))}
      </g>

      {/* 4. Rear Tires */}
      <g className="truck-wheels">
        {[rearLeftInnerWheel, rearLeftOuterWheel, rearRightInnerWheel, rearRightOuterWheel].map(
          (tire, idx) => {
            const hub = proj(tire.hubCenter);
            return (
              <g key={`rear-wheel-${idx}`} className="truck-tire-assembly">
                {backToFront(tire.faces).map((face) => (
                  <polygon
                    key={face.key}
                    className="truck-tire-face"
                    points={poly(face.points)}
                    fill={face.fill}
                    stroke="#334155"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                ))}
                <circle cx={hub.x} cy={hub.y} r={Math.max(2, 6 * hub.scale)} fill="#475569" stroke="#94a3b8" strokeWidth="1" />
                <circle cx={hub.x} cy={hub.y} r={Math.max(1, 2.5 * hub.scale)} fill="#1e293b" />
              </g>
            );
          },
        )}
      </g>

      {/* 5. Steel Chassis Structure */}
      <g className="truck-chassis-frame">
        <polygon
          points={poly([
            chassisBottomLeft,
            chassisBottomRight,
            chassisFrontRight,
            chassisFrontLeft,
          ])}
          fill="url(#truck-chassis)"
          stroke="#475569"
          strokeWidth="1.5"
        />
      </g>

      {/* 6. Dump Bed / Hopper Body */}
      <g className="truck-dump-body">
        <polygon points={poly(bedFloor)} fill="#0f172a" stroke="#334155" strokeWidth="1.2" />
        <polygon points={poly(bedLeftWall)} fill="url(#truck-bed-hopper)" stroke="#475569" strokeWidth="1.4" />
        <polygon points={poly(bedRightWall)} fill="url(#truck-bed-hopper)" stroke="#475569" strokeWidth="1.4" />
        <polygon points={poly(bedFrontWall)} fill="#1e293b" stroke="#475569" strokeWidth="1.4" />
        <polygon points={poly(bedCanopy)} fill="url(#truck-metal-body)" stroke="var(--accent, #38bdf8)" strokeWidth="1.5" />
        <polygon points={poly(bedTailgate)} fill="#1e293b" stroke="#475569" strokeWidth="1.6" />

        {/* Reinforcement Ribs */}
        {[-0.9, -0.4, 0.1].map((ribY) => (
          <line
            key={`rib-left-${ribY}`}
            x1={proj({ x_m: -0.58, y_m: ribY, z_m: 0.50 }).x}
            y1={proj({ x_m: -0.58, y_m: ribY, z_m: 0.50 }).y}
            x2={proj({ x_m: -0.76, y_m: ribY, z_m: 1.16 }).x}
            y2={proj({ x_m: -0.76, y_m: ribY, z_m: 1.16 }).y}
            stroke="#64748b"
            strokeWidth="1.8"
          />
        ))}
        {[-0.9, -0.4, 0.1].map((ribY) => (
          <line
            key={`rib-right-${ribY}`}
            x1={proj({ x_m: 0.58, y_m: ribY, z_m: 0.50 }).x}
            y1={proj({ x_m: 0.58, y_m: ribY, z_m: 0.50 }).y}
            x2={proj({ x_m: 0.76, y_m: ribY, z_m: 1.16 }).x}
            y2={proj({ x_m: 0.76, y_m: ribY, z_m: 1.16 }).y}
            stroke="#64748b"
            strokeWidth="1.8"
          />
        ))}
      </g>

      {/* 7. Operator Cab & Windshield */}
      <g className="truck-cab-assembly">
        <polygon points={poly(deckBox)} fill="#1e293b" stroke="#334155" strokeWidth="1.2" />
        <polygon points={poly(deckBoxTop)} fill="#334155" stroke="#475569" strokeWidth="1.2" />
        <polygon points={poly(cabBase)} fill="#0f172a" stroke="#334155" strokeWidth="1.2" />
        <polygon points={poly(cabRoof)} fill="url(#truck-metal-body)" stroke="var(--accent, #38bdf8)" strokeWidth="1.6" />
        <polygon points={poly(cabLeftWindow)} fill="#0369a1" fillOpacity="0.8" stroke="#38bdf8" strokeWidth="1.2" />
        <polygon points={poly(windshield)} fill="url(#truck-windshield-glass)" stroke="#7dd3fc" strokeWidth="1.8" />
      </g>

      {/* 8. Steered Front Wheels */}
      <g className="truck-front-wheels">
        {[frontLeftWheel, frontRightWheel].map((tire, idx) => {
          const hub = proj(tire.hubCenter);
          return (
            <g key={`front-wheel-${idx}`} className="truck-tire-assembly">
              {backToFront(tire.faces).map((face) => (
                <polygon
                  key={face.key}
                  className="truck-tire-face"
                  points={poly(face.points)}
                  fill={face.fill}
                  stroke="#334155"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              ))}
              <circle cx={hub.x} cy={hub.y} r={Math.max(2, 6 * hub.scale)} fill="#475569" stroke="#94a3b8" strokeWidth="1" />
              <circle cx={hub.x} cy={hub.y} r={Math.max(1, 2.5 * hub.scale)} fill="#1e293b" />
            </g>
          );
        })}
      </g>

      {/* 9. Radiator Grille & Steel Bumper */}
      <g className="truck-front-fascia">
        <polygon points={poly(frontGrille)} fill="#090d16" stroke="#475569" strokeWidth="1.4" />
        <polygon points={poly(frontBumper)} fill="#1e293b" stroke="#94a3b8" strokeWidth="1.8" />

        {/* Headlight Lamps */}
        <circle cx={leftLightScreen.x} cy={leftLightScreen.y} r={Math.max(2.5, 4 * leftLightScreen.scale)} fill="#ffffff" stroke="#38bdf8" strokeWidth="1.2" />
        <circle cx={rightLightScreen.x} cy={rightLightScreen.y} r={Math.max(2.5, 4 * rightLightScreen.scale)} fill="#ffffff" stroke="#38bdf8" strokeWidth="1.2" />
      </g>

      {/* 10. 360° Safety Warning Beacon */}
      <g className="truck-beacon-assembly">
        <circle
          cx={beaconScreen.x}
          cy={beaconScreen.y}
          r={Math.max(3, 6.5 * beaconScreen.scale)}
          fill={hasAnyAlert ? "#ef4444" : "#f59e0b"}
          stroke="#ffffff"
          strokeWidth="1.5"
          className={hasAnyAlert ? "beacon-pulse-alert" : "beacon-pulse-normal"}
        />
        <circle
          cx={beaconScreen.x}
          cy={beaconScreen.y}
          r={Math.max(6, 12 * beaconScreen.scale)}
          fill="none"
          stroke={hasAnyAlert ? "#ef4444" : "#f59e0b"}
          strokeWidth="1"
          opacity="0.4"
          className="beacon-wave"
        />
      </g>

      {isUndersideView && (
        <g className="truck-undercarriage" aria-label="Truck undercarriage">
          <polygon
            points={poly(underbodySkidPlate)}
            fill="#111827"
            stroke="#64748b"
            strokeWidth="1.8"
          />
          <polygon
            points={poly(frontAxle)}
            fill="#0f172a"
            stroke="#94a3b8"
            strokeWidth="1.6"
          />
          <polygon
            points={poly(rearAxle)}
            fill="#0f172a"
            stroke="#94a3b8"
            strokeWidth="1.6"
          />
          <polygon
            points={poly(underbodyDriveShaft)}
            fill="#334155"
            stroke="#94a3b8"
            strokeWidth="1.4"
          />
          <polygon
            points={poly(underbodyGearbox)}
            fill="#1e293b"
            stroke="var(--accent, #38bdf8)"
            strokeWidth="1.5"
          />
          {[0.72, -0.72].map((centerY, index) => {
            const center = proj({ x_m: 0, y_m: centerY, z_m: 0.1 });
            return (
              <circle
                key={index === 0 ? "front-differential" : "rear-differential"}
                cx={center.x}
                cy={center.y}
                r={Math.max(5, 9 * center.scale)}
                fill="#0f172a"
                stroke="#94a3b8"
                strokeWidth="1.6"
              />
            );
          })}
        </g>
      )}

      {/* 11. Mounted Sensor Pods */}
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
            const isAlert = threat === "ALERT" || activeAlertSensorId === sensor.sensor_id;
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

      {/* 12. Floating Callsign Tag */}
      <g className="truck-callsign-hud" transform={`translate(${callsignScreen.x}, ${callsignScreen.y})`}>
        <rect
          x="-48"
          y="-14"
          width="96"
          height="18"
          rx="5"
          fill="rgba(3, 7, 18, 0.94)"
          stroke={hasAnyAlert ? "#ef4444" : isPrimary ? "var(--accent, #38bdf8)" : "#94a3b8"}
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
