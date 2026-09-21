import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { availableRangeReadings } from "../state/rangeReadings";
import { availableSpatialPoints } from "../state/spatialPoints";
import {
  formatNumber,
  primaryVehicle,
  primaryVehicleOrNull,
} from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import type { SpatialPoint, WorldState } from "../types";
import {
  applyImuTransform,
  cameraOrbitAfterDrag,
  cameraPitchAfterDrag,
  CAMERA_ORBIT_MAX_DEG,
  CAMERA_ORBIT_MIN_DEG,
  CAMERA_PITCH_MAX_DEG,
  CAMERA_PITCH_MIN_DEG,
  DEFAULT_CAMERA_PITCH_DEG,
  generateFovSectorPath,
  getSensorThreatLevel,
  obstacleVisualRadius,
  pointDistanceFromSensor,
  projectVehiclePointWithCamera,
  rangeEndpoint,
  worldPointToVehicle,
  type CameraViewConfig,
  type ImuOrientation,
  type ThreatLevel,
  type VehiclePoint3D,
} from "./spatialProjection";
import { Vehicle3DTruck } from "./Vehicle3DTruck";
import { demoRockPoint, HaulRoad, HaulTraffic } from "./HaulScene";
import { NavigationMap } from "./NavigationMap";

interface SpatialDashboardProps {
  world: WorldState;
  connection: ConnectionState;
  sensorSettings: SensorDisplaySetting[];
}

interface DisplayPoint {
  source: SensorDisplaySetting;
  point: VehiclePoint3D;
  spatialPoint: SpatialPoint;
  distanceM: number;
}

function displayPoints(
  points: SpatialPoint[],
  world: WorldState,
  sensors: SensorDisplaySetting[],
): DisplayPoint[] {
  const vehicle = primaryVehicle(world);
  const settingsById = new Map<string, SensorDisplaySetting>(
    sensors.map((sensor) => [sensor.sensor_id, sensor]),
  );
  // Keep the same last 220 eligible returns, without transforming older points
  // that cannot appear in the existing display budget.
  const result: DisplayPoint[] = [];
  for (let index = points.length - 1; index >= 0 && result.length < 220; index--) {
    const spatialPoint = points[index];
    const source = settingsById.get(spatialPoint.source_sensor_id);
    if (!source) continue;
    const point = worldPointToVehicle(spatialPoint, vehicle);
    const distanceM = pointDistanceFromSensor(point, source);
    if (distanceM > source.visual_range_m * 1.45 + 0.6) continue;
    result.push({ source, point, spatialPoint, distanceM });
  }
  return result.reverse();
}

function groundCirclePath(
  radiusM: number,
  cameraConfig: CameraViewConfig = {},
  segments: number = 36,
): string {
  const step = (2 * Math.PI) / segments;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= segments; i++) {
    const angle = i * step;
    const x = Math.sin(angle) * radiusM;
    const y = Math.cos(angle) * radiusM;
    const pt = projectVehiclePointWithCamera(
      { x_m: x, y_m: y, z_m: 0 },
      cameraConfig,
    );
    points.push(pt);
  }
  return (
    points.reduce((acc, pt, idx) => {
      if (idx === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      return `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, "") + " Z"
  );
}

function floorGrid(cameraConfig: CameraViewConfig = {}) {
  const longitudinal = Array.from({ length: 11 }, (_, index) => -5 + index);
  const lateral = Array.from({ length: 13 }, (_, index) => -6 + index);
  const rangeRings = [1.0, 2.0, 3.0, 4.0, 5.0];

  return (
    <g className="spatial-floor-grid" aria-hidden="true">
      {/* Rectangular grid lines */}
      {longitudinal.map((x) => {
        const near = projectVehiclePointWithCamera(
          { x_m: x, y_m: -4.5, z_m: 0 },
          cameraConfig,
        );
        const far = projectVehiclePointWithCamera(
          { x_m: x, y_m: 6.5, z_m: 0 },
          cameraConfig,
        );
        return (
          <line key={`x-${x}`} x1={near.x} y1={near.y} x2={far.x} y2={far.y} />
        );
      })}
      {lateral.map((y) => {
        const left = projectVehiclePointWithCamera(
          { x_m: -5.5, y_m: y, z_m: 0 },
          cameraConfig,
        );
        const right = projectVehiclePointWithCamera(
          { x_m: 5.5, y_m: y, z_m: 0 },
          cameraConfig,
        );
        return (
          <line
            key={`y-${y}`}
            x1={left.x}
            y1={left.y}
            x2={right.x}
            y2={right.y}
          />
        );
      })}

      {/* Concentric Range Circles on Floor */}
      {rangeRings.map((radius) => (
        <path
          key={`range-ring-${radius}`}
          d={groundCirclePath(radius, cameraConfig)}
          className={`range-distance-ring ${radius <= 2.0 ? "inner-danger-boundary" : ""}`}
        />
      ))}

      {/* Distance Labels along Forward & Lateral Axes */}
      {rangeRings.map((radius) => {
        const fwdPos = projectVehiclePointWithCamera(
          { x_m: 0, y_m: radius, z_m: 0 },
          cameraConfig,
        );
        const rearPos = projectVehiclePointWithCamera(
          { x_m: 0, y_m: -radius, z_m: 0 },
          cameraConfig,
        );
        const rightPos = projectVehiclePointWithCamera(
          { x_m: radius, y_m: 0, z_m: 0 },
          cameraConfig,
        );
        const leftPos = projectVehiclePointWithCamera(
          { x_m: -radius, y_m: 0, z_m: 0 },
          cameraConfig,
        );

        return (
          <g key={`dist-labels-${radius}`} className="spatial-distance-labels">
            <text x={fwdPos.x + 8} y={fwdPos.y - 4} className="dist-tick-label">
              {radius.toFixed(0)}m
            </text>
            <text
              x={rearPos.x + 8}
              y={rearPos.y + 10}
              className="dist-tick-label"
            >
              {radius.toFixed(0)}m
            </text>
            <text
              x={rightPos.x + 4}
              y={rightPos.y - 4}
              className="dist-tick-label"
            >
              {radius.toFixed(0)}m
            </text>
            <text
              x={leftPos.x - 22}
              y={leftPos.y - 4}
              className="dist-tick-label"
            >
              {radius.toFixed(0)}m
            </text>
          </g>
        );
      })}

      {[
        { label: "Front", x_m: 0, y_m: 4.3 },
        { label: "Rear", x_m: 0, y_m: -3.8 },
        { label: "Left", x_m: -4.3, y_m: 0 },
        { label: "Right", x_m: 4.3, y_m: 0 },
      ].map(({ label, ...position }) => {
        const screen = projectVehiclePointWithCamera(
          { ...position, z_m: 0 },
          cameraConfig,
        );
        return (
          <text
            key={label}
            x={Math.max(40, Math.min(960, screen.x))}
            y={Math.max(30, Math.min(600, screen.y + 20))}
            textAnchor="middle"
            className="spatial-axis-marker"
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

function sensorClass(sensorId: string): string {
  return `sensor-${sensorId.replaceAll("_", "-")}`;
}

const DEFAULT_TRUCK_ORBIT_DEG = 0;

export function SpatialDashboard({
  world,
  connection,
  sensorSettings,
}: SpatialDashboardProps) {
  const showFovSectors = true;
  const showDistanceRings = true;
  const showPointAuras = true;
  const showImuControls = false;
  const [imuMode, setImuMode] = useState<"LIVE_IMU" | "MANUAL_JOG">("LIVE_IMU");
  const [manualPitch, setManualPitch] = useState(0);
  const [manualRoll, setManualRoll] = useState(0);
  const [manualYaw, setManualYaw] = useState(0);
  const [cameraOrbit, setCameraOrbit] = useState(DEFAULT_TRUCK_ORBIT_DEG);
  const [cameraPitch, setCameraPitch] = useState(DEFAULT_CAMERA_PITCH_DEG);
  const [isCameraDragging, setIsCameraDragging] = useState(false);
  const isCrusherDumping =
    world.mode === "SIMULATED" &&
    Boolean(
      (world.haul_route?.phase === "ARRIVED" &&
        world.haul_route.destination === "Dump point") ||
        world.haul_route?.next_instruction?.toLowerCase().includes("crusher"),
    );

  const isReturningEmpty =
    world.mode === "SIMULATED" &&
    world.haul_route?.destination === "Mine loading bay";

  const [dumpAngleDeg, setDumpAngleDeg] = useState(0);
  const [oreLevel, setOreLevel] = useState(() => (isReturningEmpty ? 0.0 : 1.0));
  const dumpTimerRef = useRef(0);
  const dumpAnimRef = useRef<number | null>(null);
  const cameraDrag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const pendingOrbitDelta = useRef({ x: 0, y: 0 });
  const orbitAnimationFrame = useRef<number | null>(null);
  const dashboard = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    let lastTime = performance.now();

    const animateDump = (time: number) => {
      if (!active) return;
      const dt = Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;

      if (isCrusherDumping) {
        dumpTimerRef.current += dt;
        const t = dumpTimerRef.current;
        if (t <= 1.4) {
          const p = Math.min(1.0, t / 1.4);
          const ease = p * p * (3 - 2 * p);
          setDumpAngleDeg(ease * 55);
        } else if (t <= 4.2) {
          setDumpAngleDeg(55);
          const pourP = Math.min(1.0, (t - 1.4) / 2.2);
          setOreLevel(Math.max(0.0, 1.0 - pourP));
        } else if (t <= 5.4) {
          const p = Math.min(1.0, (t - 4.2) / 1.2);
          const ease = p * p * (3 - 2 * p);
          setDumpAngleDeg((1 - ease) * 55);
          setOreLevel(0.0);
        } else {
          setDumpAngleDeg(0);
          setOreLevel(0.0);
        }
      } else {
        dumpTimerRef.current = 0;
        setDumpAngleDeg((prev) => (prev > 0 ? Math.max(0, prev - dt * 60) : 0));
        if (world.haul_route?.destination === "Mine loading bay") {
          setOreLevel(0.0);
        } else if (
          world.haul_route?.destination === "Dump point" &&
          (world.haul_route?.distance_m ?? 99) < 10
        ) {
          setOreLevel(1.0);
        }
      }

      dumpAnimRef.current = requestAnimationFrame(animateDump);
    };

    dumpAnimRef.current = requestAnimationFrame(animateDump);
    return () => {
      active = false;
      if (dumpAnimRef.current !== null) cancelAnimationFrame(dumpAnimRef.current);
    };
  }, [
    isCrusherDumping,
    world.haul_route?.destination,
    world.haul_route?.distance_m,
  ]);

  useEffect(() => {
    const updateVisibility = () => {
      if (!dashboard.current) return;
      dashboard.current.dataset.pageHidden = String(document.hidden);
      // CSS covers the pulses; SVG's own timeline drives unloading particles.
      dashboard.current.querySelectorAll("svg").forEach((svg) => {
        if (document.hidden) svg.pauseAnimations?.();
        else svg.unpauseAnimations?.();
      });
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(
    () => () => {
      if (orbitAnimationFrame.current !== null) {
        window.cancelAnimationFrame(orbitAnimationFrame.current);
      }
    },
    [],
  );

  const transportConnected = connection === "CONNECTED";
  const reportedVehicle = primaryVehicleOrNull(world);
  const connected = transportConnected && reportedVehicle !== null;
  const vehicle = reportedVehicle ?? primaryVehicle(world);
  const maxVisualRange = Math.max(
    6.5,
    ...sensorSettings.map((sensor) => sensor.visual_range_m + 2.5),
  );
  const ranges = useMemo(
    () => availableRangeReadings(world.ranges, world.sensor_health, connected),
    [world.ranges, world.sensor_health, connected],
  );
  const readingById = useMemo(
    () => new Map(ranges.map((reading) => [reading.sensor_id, reading])),
    [ranges],
  );
  const latestReadingById = useMemo(
    () =>
      new Map(
        (connected ? world.ranges : []).map((reading) => [
          reading.sensor_id,
          reading,
        ]),
      ),
    [connected, world.ranges],
  );

  const scanSweepRef = useRef<
    Map<
      string,
      {
        point: VehiclePoint3D;
        spatialPoint: SpatialPoint;
        source: SensorDisplaySetting;
        distanceM: number;
        updatedAtMs: number;
      }
    >
  >(new Map());

  const sweepPoints = useMemo(() => {
    const scanSweep = scanSweepRef.current;
    if (!connected) {
      scanSweep.clear();
      return [];
    }

    const nowMs = world.generated_at_ms || Date.now();
    const sweepRetentionMs = 1_800;

    for (const [key, point] of scanSweep) {
      const ageMs = nowMs - point.updatedAtMs;
      if (ageMs < 0 || ageMs > sweepRetentionMs) {
        scanSweep.delete(key);
      }
    }

    for (const sensor of sensorSettings) {
      const reading = readingById.get(sensor.sensor_id);
      if (
        !reading ||
        !reading.is_valid ||
        !Number.isFinite(reading.range_m) ||
        reading.range_m <= 0.1
      ) {
        continue;
      }

      const hitMarginM = Math.max(0.08, sensor.visual_range_m * 0.03);
      if (reading.range_m >= sensor.visual_range_m - hitMarginM) {
        continue;
      }

      const angle = sensor.scanner
        ? Math.round((reading.angle_deg ?? 0) / 4) * 4
        : 0;
      const point = rangeEndpoint(sensor, { ...reading, angle_deg: angle });
      const spatialPoint: SpatialPoint = {
        x_m: point.x_m,
        y_m: point.y_m,
        height_hint_m: point.z_m,
        source_sensor_id: sensor.sensor_id,
        quality: reading.quality ?? 0.95,
        timestamp_ms: nowMs,
      };
      const key = sensor.scanner
        ? `${sensor.sensor_id}_${angle}`
        : sensor.sensor_id;

      scanSweep.set(key, {
        point,
        spatialPoint,
        source: sensor,
        distanceM: reading.range_m,
        updatedAtMs: nowMs,
      });
    }

    for (const key of scanSweep.keys()) {
      if (
        key.startsWith("simulated-rock-") ||
        key.startsWith("simulated-road-")
      ) {
        scanSweep.delete(key);
      }
    }

    if (world.mode === "SIMULATED") {
      const frontScanner = sensorSettings.find(
        (sensor) => sensor.sensor_id === "front_scanner",
      );
      const rearScanner = sensorSettings.find(
        (sensor) => sensor.sensor_id === "rear_scanner",
      );
      const leftSensor = sensorSettings.find(
        (sensor) => sensor.sensor_id === "left_side",
      );
      const rightSensor = sensorSettings.find(
        (sensor) => sensor.sensor_id === "right_side",
      );
      const roadCandidates: Array<{
        point: VehiclePoint3D;
        source: SensorDisplaySetting;
        distanceM: number;
      }> = [];
      const occupiedCells = new Set<string>();

      for (const feature of world.reference_map?.features ?? []) {
        if (feature.feature_type !== "ROAD" || feature.points.length < 2) {
          continue;
        }

        for (let segment = 0; segment < feature.points.length; segment++) {
          const start = feature.points[segment];
          const end = feature.points[(segment + 1) % feature.points.length];
          const lengthM = Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m);
          const samples = Math.max(1, Math.ceil(lengthM / 0.32));

          for (let sample = 0; sample <= samples; sample++) {
            const t = sample / samples;
            const local = worldPointToVehicle(
              {
                x_m: start.x_m + (end.x_m - start.x_m) * t,
                y_m: start.y_m + (end.y_m - start.y_m) * t,
                height_hint_m: 0.04,
                source_sensor_id: "front_scanner",
                quality: 0.94,
                timestamp_ms: nowMs,
              },
              vehicle,
            );
            const vehicleDistanceM = Math.hypot(local.x_m, local.y_m);
            if (vehicleDistanceM < 0.7 || vehicleDistanceM > 4.3) continue;

            const bearingDeg =
              (Math.atan2(local.x_m, local.y_m) * 180) / Math.PI;
            const rearBearingDeg =
              (Math.atan2(-local.x_m, -local.y_m) * 180) / Math.PI;
            let source: SensorDisplaySetting | undefined;

            if (local.y_m >= 0.15 && Math.abs(bearingDeg) <= 82) {
              source = frontScanner;
            } else if (
              local.y_m <= -0.15 &&
              Math.abs(rearBearingDeg) <= 82
            ) {
              source = rearScanner;
            } else if (local.x_m < 0) {
              source = leftSensor;
            } else {
              source = rightSensor;
            }
            if (!source) continue;

            const distanceM = pointDistanceFromSensor(local, source);
            if (distanceM > source.visual_range_m + 0.25) continue;

            const cell = `${Math.round(local.x_m / 0.34)}:${Math.round(
              local.y_m / 0.34,
            )}`;
            if (occupiedCells.has(cell)) continue;
            occupiedCells.add(cell);
            roadCandidates.push({
              point: { ...local, z_m: 0.04 },
              source,
              distanceM,
            });
          }
        }
      }

      roadCandidates
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 42)
        .forEach(({ point, source, distanceM }, index) => {
          const spatialPoint: SpatialPoint = {
            x_m: point.x_m,
            y_m: point.y_m,
            height_hint_m: point.z_m,
            source_sensor_id: source.sensor_id,
            quality: 0.94,
            timestamp_ms: nowMs,
          };
          scanSweep.set(`simulated-road-${index}`, {
            point,
            spatialPoint,
            source,
            distanceM,
            updatedAtMs: nowMs,
          });
        });
    }

    const reportedRock = world.haul_route?.obstacle_detected
      ? world.haul_route.obstacle
      : null;
    const rockWorld = reportedRock ?? demoRockPoint(world);
    if (rockWorld) {
      const rockLocal = worldPointToVehicle(
        {
          x_m: rockWorld.x_m,
          y_m: rockWorld.y_m,
          height_hint_m: 0.35,
          source_sensor_id: "front_scanner",
          quality: 0.98,
          timestamp_ms: nowMs,
        },
        vehicle,
      );
      const rockDistanceM = Math.hypot(rockLocal.x_m, rockLocal.y_m);
      const rockRadiusM = reportedRock
        ? world.haul_route?.obstacle_radius_m ?? 0.45
        : 0.45;
      const detectionRangeM = 5.4;

      if (rockDistanceM <= detectionRangeM && rockDistanceM > 0.01) {
        const normalX = rockLocal.x_m / rockDistanceM;
        const normalY = rockLocal.y_m / rockDistanceM;
        const tangentX = normalY;
        const tangentY = -normalX;
        const bearingDeg =
          (Math.atan2(rockLocal.x_m, rockLocal.y_m) * 180) / Math.PI;
        const frontSensor = sensorSettings.find(
          (sensor) => sensor.sensor_id === "front_scanner",
        );
        const rearSensor = sensorSettings.find(
          (sensor) => sensor.sensor_id === "rear_scanner",
        );
        const sideSensor = sensorSettings.find(
          (sensor) =>
            sensor.sensor_id === (bearingDeg >= 0 ? "right_side" : "left_side"),
        );
        const primarySensor =
          Math.abs(bearingDeg) <= 65
            ? frontSensor
            : Math.abs(bearingDeg) >= 115
              ? rearSensor
              : sideSensor;
        const sources = [primarySensor, sideSensor, primarySensor].filter(
          (sensor): sensor is SensorDisplaySetting => Boolean(sensor),
        );

        for (let index = 0; index < 11; index++) {
          const spread = ((index - 5) / 5) * rockRadiusM * 0.9;
          const depthOffset = (index % 3) * rockRadiusM * 0.08;
          const point: VehiclePoint3D = {
            x_m:
              rockLocal.x_m - normalX * (rockRadiusM - depthOffset) +
              tangentX * spread,
            y_m:
              rockLocal.y_m - normalY * (rockRadiusM - depthOffset) +
              tangentY * spread,
            z_m: 0.05,
          };
          const source = sources[index % sources.length];
          const spatialPoint: SpatialPoint = {
            x_m: point.x_m,
            y_m: point.y_m,
            height_hint_m: point.z_m,
            source_sensor_id: source.sensor_id,
            quality: 0.98,
            timestamp_ms: nowMs,
          };
          scanSweep.set(`simulated-rock-${index}`, {
            point,
            spatialPoint,
            source,
            distanceM: pointDistanceFromSensor(point, source),
            updatedAtMs: nowMs,
          });
        }
      }
    }

    return Array.from(scanSweep.values());
  }, [connected, readingById, sensorSettings, vehicle, world]);

  const plottedPoints = useMemo(() => {
    const points = availableSpatialPoints(
      world.spatial_points,
      world.sensor_health,
      connected,
      world.generated_at_ms,
      vehicle,
      maxVisualRange,
    );
    const displayedBackend = displayPoints(points, world, sensorSettings);
    if (displayedBackend.length >= 200) {
      return displayedBackend;
    }
    const combined = [...displayedBackend, ...sweepPoints];
    return combined.slice(-220);
  }, [
    world.spatial_points,
    world.sensor_health,
    world.generated_at_ms,
    connected,
    vehicle,
    maxVisualRange,
    sensorSettings,
    sweepPoints,
  ]);
  const trustedSensorIds = new Set(ranges.map((reading) => reading.sensor_id));
  const trustedCoverageCount = sensorSettings.filter((sensor) =>
    trustedSensorIds.has(sensor.sensor_id),
  ).length;

  // MPU-6050 IMU Live Motion Calculation
  const imuHeading = world.motion.imu_heading_deg;
  const imuYawRate = world.motion.imu_yaw_rate_dps;
  const speed = vehicle.speed_mps;
  const isEmergencyBraking = world.emergency.state === "EMERGENCY_STOP";

  // Dynamic physical pitch & roll reaction from MPU-6050 / vehicle physics
  const autoPitch = isEmergencyBraking
    ? -5.5
    : Math.max(-8, Math.min(6, speed > 0.1 ? -1.2 : 0));
  const autoRoll = Math.max(-15, Math.min(15, -imuYawRate * 0.18));
  const autoSteer = Math.max(-28, Math.min(28, imuYawRate * 0.45));

  const effectivePitch = imuMode === "LIVE_IMU" ? autoPitch : manualPitch;
  const effectiveRoll = imuMode === "LIVE_IMU" ? autoRoll : manualRoll;
  const effectiveYaw =
    imuMode === "LIVE_IMU"
      ? connected
        ? ((imuHeading - vehicle.heading_deg + 540) % 360) - 180
        : 0
      : manualYaw;
  const effectiveSteer = imuMode === "LIVE_IMU" ? autoSteer : manualYaw * 0.25;

  const imuOrientation: ImuOrientation = {
    pitch_deg: effectivePitch,
    roll_deg: effectiveRoll,
    yaw_deg: effectiveYaw,
    suspension_z_m: isEmergencyBraking ? -0.04 : 0,
  };

  const cameraConfig: CameraViewConfig = {
    orbitYawDeg: cameraOrbit,
    cameraPitchDeg: cameraPitch,
  };
  const grid = useMemo(
    () => floorGrid({ orbitYawDeg: cameraOrbit, cameraPitchDeg: cameraPitch }),
    [cameraOrbit, cameraPitch],
  );
  const cameraPitchLabel =
    cameraPitch < 0
      ? `${Math.abs(Math.round(cameraPitch))}° below`
      : `${Math.round(cameraPitch)}° above`;
  // Sensor Threat Evaluations
  const sensorThreats = sensorSettings.map((sensor) => {
    const reading = readingById.get(sensor.sensor_id);
    const threat: ThreatLevel = getSensorThreatLevel(reading, sensor);
    return {
      sensor,
      reading,
      threat,
      rangeM: reading?.range_m ?? null,
      isAlert: threat === "ALERT",
      isCaution: threat === "CAUTION",
    };
  });

  const alerts = sensorThreats.filter((st) => st.isAlert && st.rangeM !== null);
  const closestAlert = alerts.sort(
    (a, b) => (a.rangeM ?? 99) - (b.rangeM ?? 99),
  )[0];

  const cautions = sensorThreats.filter(
    (st) => st.isCaution && st.rangeM !== null,
  );
  const closestCaution = cautions.sort(
    (a, b) => (a.rangeM ?? 99) - (b.rangeM ?? 99),
  )[0];
  const hasCompleteCoverage =
    sensorSettings.length > 0 &&
    trustedCoverageCount === sensorSettings.length &&
    sensorThreats.every(({ threat }) => threat !== "UNKNOWN");

  const nearestAnyReading = sensorThreats
    .filter((st) => st.reading?.is_valid && st.rangeM !== null)
    .sort((a, b) => (a.rangeM ?? 99) - (b.rangeM ?? 99))[0];

  const resetAttitude = () => {
    setManualPitch(0);
    setManualRoll(0);
    setManualYaw(0);
    setCameraOrbit(DEFAULT_TRUCK_ORBIT_DEG);
    setCameraPitch(DEFAULT_CAMERA_PITCH_DEG);
  };

  const startCameraOrbitDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    cameraDrag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsCameraDragging(true);
    event.preventDefault();
  };

  const flushCameraOrbit = () => {
    orbitAnimationFrame.current = null;
    const { x: horizontalDelta, y: verticalDelta } = pendingOrbitDelta.current;
    pendingOrbitDelta.current = { x: 0, y: 0 };
    if (horizontalDelta !== 0) {
      setCameraOrbit((current) =>
        cameraOrbitAfterDrag(current, horizontalDelta),
      );
    }
    if (verticalDelta !== 0) {
      setCameraPitch((current) => cameraPitchAfterDrag(current, verticalDelta));
    }
  };

  const moveCameraOrbit = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = cameraDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const horizontalDelta = event.clientX - drag.clientX;
    const verticalDelta = event.clientY - drag.clientY;
    cameraDrag.current = {
      ...drag,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    pendingOrbitDelta.current.x += horizontalDelta;
    pendingOrbitDelta.current.y += verticalDelta;
    if (orbitAnimationFrame.current === null) {
      orbitAnimationFrame.current =
        window.requestAnimationFrame(flushCameraOrbit);
    }
    event.preventDefault();
  };

  const stopCameraOrbitDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (cameraDrag.current?.pointerId !== event.pointerId) return;
    cameraDrag.current = null;
    setIsCameraDragging(false);
    if (orbitAnimationFrame.current !== null) {
      window.cancelAnimationFrame(orbitAnimationFrame.current);
      flushCameraOrbit();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section
      ref={dashboard}
      className="dashboard spatial-dashboard"
      aria-label="Live 2.5D ToF surrounding view"
    >
      <header className="page-heading spatial-page-heading">
        <h2>Spatial view</h2>
      </header>

      {/* Top Banner Alert when obstacle is detected */}
      {closestAlert && (
        <div className="spatial-alert spatial-alert-danger" role="alert">
          <div className="alert-badge-group">
            <span className="alert-pulse-dot" />
            <strong>
              PROXIMITY HAZARD · {closestAlert.sensor.label.toUpperCase()}
            </strong>
          </div>
          <span>
            Obstacle detected at{" "}
            <strong>{closestAlert.rangeM?.toFixed(2)} m</strong> (Threshold:{" "}
            {closestAlert.sensor.alert_distance_m.toFixed(2)} m). Brake or clear
            sector.
          </span>
        </div>
      )}
      {!closestAlert && closestCaution && (
        <div className="spatial-alert spatial-alert-caution" role="status">
          <div className="alert-badge-group">
            <span className="caution-pulse-dot" />
            <strong>
              PROXIMITY CAUTION · {closestCaution.sensor.label.toUpperCase()}
            </strong>
          </div>
          <span>
            Obstacle at <strong>{closestCaution.rangeM?.toFixed(2)} m</strong>{" "}
            approaching alert zone (
            {closestCaution.sensor.alert_distance_m.toFixed(2)} m).
          </span>
        </div>
      )}

      <div className="spatial-layout">
        <article className="spatial-scene-card">
          {/* Spatial Viewport Toolbar */}
          <div className="spatial-viewport-toolbar">
            {/* Live Threat Pill HUD */}
            <div className="spatial-threat-pill">
              {connected && hasCompleteCoverage && world.mode === "SIMULATED" && world.haul_route && (world.haul_route.obstacle_detected || world.haul_route.traffic_slowing || world.haul_route.lead_waiting) ? (
                <span className={`threat-pill ${world.emergency.motor_cut ? "threat-danger" : "threat-caution"}`} role="status">
                  <i className="threat-status-dot" aria-hidden="true" />
                  {world.haul_route.next_instruction}
                </span>
              ) : closestAlert ? (
                <span className="threat-pill threat-danger">
                  <i className="threat-status-dot" aria-hidden="true" />
                  Hazard · {closestAlert.sensor.label} ·{" "}
                  {closestAlert.rangeM?.toFixed(2)} m
                </span>
              ) : closestCaution ? (
                <span className="threat-pill threat-caution">
                  <i className="threat-status-dot" aria-hidden="true" />
                  Caution · {closestCaution.sensor.label} ·{" "}
                  {closestCaution.rangeM?.toFixed(2)} m
                </span>
              ) : connected && hasCompleteCoverage ? (
                <span className="threat-pill threat-clear">
                  <i className="threat-status-dot" aria-hidden="true" />
                  No proximity hazards · {trustedCoverageCount}/
                  {sensorSettings.length} valid
                </span>
              ) : connected ? (
                <span className="threat-pill threat-offline">
                  <i className="threat-status-dot" aria-hidden="true" />
                  Coverage incomplete · {trustedCoverageCount}/
                  {sensorSettings.length} valid
                </span>
              ) : (
                <span className="threat-pill threat-offline">
                  <i className="threat-status-dot" aria-hidden="true" />
                  No telemetry
                </span>
              )}
            </div>
          </div>

          {/* MPU-6050 Live Motion & Attitude Control Panel */}
          {showImuControls && (
            <div
              className="imu-motion-panel"
              aria-label="View and motion controls"
            >
              <div className="imu-hud-readout">
                <div className="imu-hud-badge">
                  <small>MPU-6050 YAW</small>
                  <strong>
                    {connected ? `${formatNumber(imuHeading, 0)}°` : "--"}
                  </strong>
                </div>
                <div className="imu-hud-badge">
                  <small>YAW RATE</small>
                  <strong>
                    {connected ? `${formatNumber(imuYawRate, 1)}°/s` : "--"}
                  </strong>
                </div>
                <div className="imu-hud-badge">
                  <small>VISUAL PITCH</small>
                  <strong>{formatNumber(effectivePitch, 1)}°</strong>
                </div>
                <div className="imu-hud-badge">
                  <small>VISUAL ROLL</small>
                  <strong>{formatNumber(effectiveRoll, 1)}°</strong>
                </div>
              </div>

              <div className="imu-controls-row">
                <div className="imu-mode-switch">
                  <button
                    type="button"
                    className={`imu-mode-btn ${imuMode === "LIVE_IMU" ? "active" : ""}`}
                    onClick={() => setImuMode("LIVE_IMU")}
                  >
                    Live estimate
                  </button>
                  <button
                    type="button"
                    className={`imu-mode-btn ${imuMode === "MANUAL_JOG" ? "active" : ""}`}
                    onClick={() => setImuMode("MANUAL_JOG")}
                  >
                    Manual preview
                  </button>
                </div>

                {imuMode === "MANUAL_JOG" && (
                  <div className="imu-sliders-group">
                    <label>
                      <span>Pitch: {manualPitch}°</span>
                      <input
                        type="range"
                        min="-20"
                        max="20"
                        step="1"
                        value={manualPitch}
                        onChange={(e) => setManualPitch(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      <span>Roll: {manualRoll}°</span>
                      <input
                        type="range"
                        min="-25"
                        max="25"
                        step="1"
                        value={manualRoll}
                        onChange={(e) => setManualRoll(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      <span>Yaw: {manualYaw}°</span>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        step="2"
                        value={manualYaw}
                        onChange={(e) => setManualYaw(Number(e.target.value))}
                      />
                    </label>
                  </div>
                )}

                <div className="camera-orbit-control">
                  <label>
                    <span>Orbit: {Math.round(cameraOrbit)}°</span>
                    <input
                      type="range"
                      min={CAMERA_ORBIT_MIN_DEG}
                      max={CAMERA_ORBIT_MAX_DEG}
                      step="1"
                      value={cameraOrbit}
                      onChange={(e) => setCameraOrbit(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    <span>View: {cameraPitchLabel}</span>
                    <input
                      type="range"
                      min={CAMERA_PITCH_MIN_DEG}
                      max={CAMERA_PITCH_MAX_DEG}
                      step="1"
                      value={cameraPitch}
                      onChange={(e) => setCameraPitch(Number(e.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="imu-reset-btn"
                    onClick={resetAttitude}
                  >
                    Reset View
                  </button>
                </div>
              </div>
            </div>
          )}

          <svg
            className={`spatial-scene ${isCameraDragging ? "is-orbiting" : ""}`}
            viewBox="0 0 1000 620"
            role="img"
            aria-label={`Interactive 2.5D ToF display with ${plottedPoints.length} mapped returns and ${ranges.length} valid live ranges. Drag horizontally to orbit and vertically to change the viewing angle.`}
            onPointerDown={startCameraOrbitDrag}
            onPointerMove={moveCameraOrbit}
            onPointerUp={stopCameraOrbitDrag}
            onPointerCancel={stopCameraOrbitDrag}
            onLostPointerCapture={() => {
              if (orbitAnimationFrame.current !== null) {
                window.cancelAnimationFrame(orbitAnimationFrame.current);
                flushCameraOrbit();
              }
              cameraDrag.current = null;
              setIsCameraDragging(false);
            }}
          >
            <defs>
              <linearGradient id="spatial-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--page-bg, #070a10)" />
                <stop offset="100%" stopColor="var(--surface-inset, #0d131d)" />
              </linearGradient>

              <radialGradient id="spatial-floor" cx="50%" cy="40%" r="80%">
                <stop offset="0%" stopColor="var(--surface-inset, #0f172a)" />
                <stop offset="100%" stopColor="var(--page-bg, #030712)" />
              </radialGradient>

              <radialGradient
                id="fov-danger-gradient"
                cx="50%"
                cy="0%"
                r="100%"
              >
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.65" />
                <stop offset="70%" stopColor="#ef4444" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.04" />
              </radialGradient>

              <radialGradient
                id="fov-caution-gradient"
                cx="50%"
                cy="0%"
                r="100%"
              >
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.5" />
                <stop offset="70%" stopColor="#f59e0b" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.03" />
              </radialGradient>

              <radialGradient id="fov-clear-gradient" cx="50%" cy="0%" r="100%">
                <stop
                  offset="0%"
                  stopColor="var(--accent, #38bdf8)"
                  stopOpacity="0.32"
                />
                <stop
                  offset="70%"
                  stopColor="var(--accent, #38bdf8)"
                  stopOpacity="0.08"
                />
                <stop
                  offset="100%"
                  stopColor="var(--accent, #38bdf8)"
                  stopOpacity="0.01"
                />
              </radialGradient>

              <radialGradient
                id="fov-unknown-gradient"
                cx="50%"
                cy="0%"
                r="100%"
              >
                <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.18" />
                <stop offset="70%" stopColor="#94a3b8" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.01" />
              </radialGradient>

              <filter
                id="point-glow"
                x="-150%"
                y="-150%"
                width="400%"
                height="400%"
              >
                <feGaussianBlur stdDeviation="3.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <filter
                id="cloud-glow"
                filterUnits="userSpaceOnUse"
                x="-20"
                y="-20"
                width="1040"
                height="660"
              >
                <feGaussianBlur stdDeviation="3.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <filter
                id="alert-hit-glow"
                x="-200%"
                y="-200%"
                width="500%"
                height="500%"
              >
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Viewport Backdrop */}
            <rect width="1000" height="620" rx="18" fill="url(#spatial-sky)" />
            <path d="M0 190H1000V620H0Z" fill="url(#spatial-floor)" />
            <line
              className="spatial-horizon"
              x1="0"
              y1="190"
              x2="1000"
              y2="190"
            />

            {/* 3D Floor Grid & Range Rings */}
            {connected && (
              <HaulRoad world={world} vehicle={vehicle} camera={cameraConfig} />
            )}
            {showDistanceRings && grid}

            {/* Sensor Coverage FOV Cones / Sectors (Dynamic Danger Red) */}
            {showFovSectors && (
              <g
                className="spatial-fov-sectors"
                aria-label="Sensor FOV coverage zones"
              >
                {sensorThreats.map(
                  ({ sensor, reading, threat, isAlert, isCaution }) => {
                    const latestReading = latestReadingById.get(
                      sensor.sensor_id,
                    );
                    const activeReading =
                      sensor.scanner && latestReading
                        ? reading
                          ? { ...reading, angle_deg: latestReading.angle_deg }
                          : {
                              ...latestReading,
                              range_m: 0,
                              quality: 0,
                              is_valid: false,
                            }
                        : reading;
                    const yaw =
                      sensor.display_pose.yaw_deg +
                      (sensor.scanner ? (activeReading?.angle_deg ?? 0) : 0);
                    const fov = sensor.scanner ? 32 : 45;
                    const range = activeReading?.is_valid
                      ? Math.max(
                          0.4,
                          Math.min(
                            activeReading.range_m,
                            sensor.visual_range_m,
                          ),
                        )
                      : Math.min(1.2, sensor.visual_range_m);

                    // Apply IMU orientation to sensor pose
                    const transformedPose = applyImuTransform(
                      sensor.display_pose,
                      imuOrientation,
                    );

                    const path = generateFovSectorPath(
                      transformedPose,
                      yaw + imuOrientation.yaw_deg,
                      fov,
                      range,
                      10,
                      cameraConfig,
                    );

                    const fillGrad = isAlert
                      ? "url(#fov-danger-gradient)"
                      : isCaution
                        ? "url(#fov-caution-gradient)"
                        : threat === "UNKNOWN"
                          ? "url(#fov-unknown-gradient)"
                          : "url(#fov-clear-gradient)";

                    const strokeColor = isAlert
                      ? "#ef4444"
                      : isCaution
                        ? "#f59e0b"
                        : threat === "UNKNOWN"
                          ? "#94a3b8"
                          : `var(--${sensorClass(sensor.sensor_id)}, #38bdf8)`;

                    return (
                      <g
                        key={`fov-${sensor.sensor_id}`}
                        className={`fov-sector-group ${isAlert ? "fov-alert-active" : ""}`}
                      >
                        <path
                          d={path}
                          fill={fillGrad}
                          stroke={strokeColor}
                          strokeWidth={isAlert ? "2.2" : "1.2"}
                          strokeDasharray={isAlert ? "6 4" : "none"}
                          className={
                            isAlert ? "fov-cone-pulse" : "fov-cone-normal"
                          }
                        />
                      </g>
                    );
                  },
                )}
              </g>
            )}

            {/* Sensor Beams & Active Raycasts                           */}
            <g className="spatial-beams">
              {sensorSettings.map((sensor) => {
                const reading = readingById.get(sensor.sensor_id);
                const latestReading = latestReadingById.get(sensor.sensor_id);
                const displayReading =
                  sensor.scanner && latestReading
                    ? reading
                      ? { ...reading, angle_deg: latestReading.angle_deg }
                      : {
                          ...latestReading,
                          range_m: 0,
                          quality: 0,
                          is_valid: false,
                        }
                    : reading;
                const rawOrigin = sensor.display_pose;
                const rawEndpoint = rangeEndpoint(sensor, displayReading);

                // Transform with MPU-6050 orientation
                const transformedOrigin = applyImuTransform(
                  rawOrigin,
                  imuOrientation,
                );
                const transformedEndpoint = applyImuTransform(
                  rawEndpoint,
                  imuOrientation,
                );

                const origin = projectVehiclePointWithCamera(
                  transformedOrigin,
                  cameraConfig,
                );
                const endpoint = projectVehiclePointWithCamera(
                  transformedEndpoint,
                  cameraConfig,
                );

                const threat = getSensorThreatLevel(reading, sensor);
                const isAlert = threat === "ALERT";
                const isCaution = threat === "CAUTION";
                const dist = reading?.range_m ?? 0;
                // OPTICAL PERSPECTIVE SCALING: Closer objects expand into larger markers
                const hitRadius = obstacleVisualRadius(dist, endpoint.scale);
                const angle =
                  sensor.display_pose.yaw_deg +
                  (sensor.scanner ? (latestReading?.angle_deg ?? 0) : 0);

                return (
                  <g
                    key={sensor.sensor_id}
                    className={`${sensorClass(sensor.sensor_id)} ${isAlert ? "beam-alert" : isCaution ? "beam-caution" : ""}`}
                  >
                    <title>{`${sensor.label}${sensor.scanner ? ` head ${angle.toFixed(0)}°` : ""}`}</title>
                    <line
                      className={`sensor-beam ${reading?.is_valid ? "sensor-beam-live" : "sensor-beam-unknown"}`}
                      x1={origin.x}
                      y1={origin.y}
                      x2={endpoint.x}
                      y2={endpoint.y}
                      strokeWidth={isAlert ? 3.2 : 2.0}
                    />

                    {/* Ground impact ellipse underneath the hit point */}
                    {reading?.is_valid && (
                      <ellipse
                        cx={endpoint.x}
                        cy={endpoint.y}
                        rx={hitRadius * 1.3}
                        ry={hitRadius * 0.7}
                        fill={
                          isAlert
                            ? "rgba(239, 68, 68, 0.45)"
                            : "rgba(56, 189, 248, 0.25)"
                        }
                        stroke={isAlert ? "#ef4444" : "var(--accent, #38bdf8)"}
                        strokeWidth="1.2"
                        className={isAlert ? "hit-ground-disc-alert" : ""}
                      />
                    )}

                    {/* Sensor Hit Core Marker with Realistic Proximity Sizing */}
                    {reading?.is_valid && (
                      <g
                        className="sensor-hit-target"
                        filter={
                          isAlert ? "url(#alert-hit-glow)" : "url(#point-glow)"
                        }
                      >
                        {isAlert && (
                          <circle
                            className="beam-hit-ripple"
                            cx={endpoint.x}
                            cy={endpoint.y}
                            r={hitRadius * 1.8}
                            fill="none"
                            stroke="#ef4444"
                            strokeWidth="2"
                          />
                        )}
                        <circle
                          className="beam-hit"
                          cx={endpoint.x}
                          cy={endpoint.y}
                          r={hitRadius}
                        />
                        <circle
                          cx={endpoint.x}
                          cy={endpoint.y}
                          r={Math.max(2, hitRadius * 0.38)}
                          fill="#ffffff"
                        />
                      </g>
                    )}

                    {/* Floating 3D Distance HUD Badge directly on the Obstacle */}
                    {reading?.is_valid && (
                      <g
                        className={`spatial-obstacle-pill ${isAlert ? "pill-alert" : isCaution ? "pill-caution" : "pill-normal"}`}
                        transform={`translate(${endpoint.x}, ${endpoint.y - hitRadius - 16})`}
                      >
                        <rect
                          x="-36"
                          y="-11"
                          width="72"
                          height="18"
                          rx="5"
                          fill="rgba(3, 7, 18, 0.94)"
                          stroke={
                            isAlert
                              ? "#ef4444"
                              : isCaution
                                ? "#f59e0b"
                                : "var(--accent, #38bdf8)"
                          }
                          strokeWidth="1.5"
                        />
                        <text
                          x="0"
                          y="2"
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight="800"
                          fontFamily="var(--mono, monospace)"
                          fill={
                            isAlert
                              ? "#ef4444"
                              : isCaution
                                ? "#f59e0b"
                                : "#f8fafc"
                          }
                        >
                          {isAlert
                            ? `⚠ ${dist.toFixed(2)}m`
                            : `${dist.toFixed(2)}m`}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Mapped 3D Point Cloud with Optical Perspective Scaling   */}
            <g className="spatial-point-cloud" filter="url(#cloud-glow)">
              {plottedPoints.flatMap(
                ({ source, point, spatialPoint, distanceM }, index) => {
                  const alert = distanceM <= source.alert_distance_m;
                  const caution = distanceM <= source.alert_distance_m * 1.5;

                  const transformedPt = applyImuTransform(
                    { ...point, z_m: 0.05 },
                    imuOrientation,
                  );
                  const screen = projectVehiclePointWithCamera(
                    transformedPt,
                    cameraConfig,
                  );
                  const radius = obstacleVisualRadius(
                    distanceM,
                    screen.scale,
                  );
                  const layerScales = [1.25, 0.95, 0.65];

                  return layerScales.map((scaleFactor, layer) => {
                    const layerRadius = radius * scaleFactor;

                    return (
                      <Fragment key={`${index}-${layer}`}>
                        {showPointAuras &&
                          layer === 0 &&
                          (alert || caution) && (
                            <ellipse
                              cx={screen.x}
                              cy={screen.y}
                              rx={radius * 1.6}
                              ry={radius * 0.9}
                              fill={
                                alert
                                  ? "rgba(239, 68, 68, 0.35)"
                                  : "rgba(245, 158, 11, 0.22)"
                              }
                              className="point-cloud-aura"
                            />
                          )}
                        <circle
                          className={`spatial-dot ${sensorClass(source.sensor_id)} ${
                            alert
                              ? "spatial-dot-alert"
                              : caution
                                ? "spatial-dot-caution"
                                : ""
                          } ${spatialPoint.quality < 0.65 ? "spatial-dot-low" : ""}`}
                          cx={screen.x}
                          cy={screen.y}
                          r={layerRadius}
                          opacity={layer === 0 ? 0.35 : layer === 1 ? 0.75 : 0.98}
                        >
                          {layer === 2 && (
                            <title>{`${source.label}: ${distanceM.toFixed(2)} m (Quality: ${Math.round(spatialPoint.quality * 100)}%)`}</title>
                          )}
                        </circle>
                      </Fragment>
                    );
                  });
                },
              )}
            </g>

            {/* Complete Moveable 3D Truck Model in Scene                */}
            {connected && (
              <HaulTraffic
                world={world}
                vehicle={vehicle}
                camera={cameraConfig}
                dumpAngleDeg={dumpAngleDeg}
              >
                <Vehicle3DTruck
                  sensors={sensorSettings}
                  readings={ranges}
                  emergencyState={world.emergency.state}
                  isPrimary={true}
                  callsign={vehicle.vehicle_id}
                  showSensorMounts={true}
                  showHeadlightBeams={true}
                  showPerimeterShield={true}
                  activeAlertSensorId={closestAlert?.sensor.sensor_id ?? null}
                  imuOrientation={imuOrientation}
                  steerAngleDeg={effectiveSteer}
                  dumpAngleDeg={dumpAngleDeg}
                  oreLevel={oreLevel}
                  cameraConfig={cameraConfig}
                />
              </HaulTraffic>
            )}
          </svg>

          {!connected && (
            <div className="spatial-empty-overlay">
              <strong>
                {connection === "CONNECTING"
                  ? "Connecting to telemetry"
                  : transportConnected
                    ? "Vehicle data unavailable"
                    : "Telemetry unavailable"}
              </strong>
            </div>
          )}

          {/* Interactive Legend Bar */}
          <div className="spatial-legend">
            <span>
              <i className="legend-dot-live" />
              Mapped return
            </span>
            <span>
              <i className="legend-line-beam" />
              Active beam
            </span>
            <span>
              <i className="legend-dot-alert" />
              Hazard
            </span>
            <span>
              <i className="legend-dot-caution" />
              Caution
            </span>
          </div>
        </article>

        {/* Sensor Heads & Real-Time Proximity Gauge Panel              */}
        <aside className="spatial-sensor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Perimeter Coverage</p>
              <h3>Sensor heads</h3>
            </div>
            <span className="source-badge">
              {trustedCoverageCount}/{sensorSettings.length} valid
            </span>
          </div>

          <div className="spatial-sensor-list">
            {sensorSettings.map((sensor) => {
              const reading = readingById.get(sensor.sensor_id);
              const latestReading = latestReadingById.get(sensor.sensor_id);
              const health = world.sensor_health.find(
                (item) => item.sensor_id === sensor.sensor_id,
              );
              const threat = getSensorThreatLevel(reading, sensor);
              const isAlert = threat === "ALERT";
              const isCaution = threat === "CAUTION";
              const rangeM = reading?.range_m ?? null;

              const gaugePct =
                rangeM !== null
                  ? Math.max(
                      5,
                      Math.min(100, (rangeM / sensor.visual_range_m) * 100),
                    )
                  : 0;

              return (
                <article
                  key={sensor.sensor_id}
                  className={`spatial-sensor-row ${
                    isAlert
                      ? "spatial-sensor-row-alert"
                      : isCaution
                        ? "spatial-sensor-row-caution"
                        : ""
                  }`}
                >
                  <span
                    className={`sensor-swatch ${sensorClass(sensor.sensor_id)}`}
                  />
                  <div className="spatial-sensor-info">
                    <div className="sensor-title-line">
                      <strong>{sensor.label}</strong>
                      <span
                        className={`sensor-threat-badge badge-${threat.toLowerCase()}`}
                      >
                        {threat}
                      </span>
                    </div>
                    <small>{health?.status ?? "OFFLINE"}</small>

                    {/* Proximity Distance Gauge Bar */}
                    {reading?.is_valid && (
                      <div
                        className="sensor-proximity-gauge"
                        title={`Distance: ${rangeM?.toFixed(2)} m`}
                      >
                        <div
                          className={`gauge-fill ${isAlert ? "gauge-alert" : isCaution ? "gauge-caution" : "gauge-clear"}`}
                          style={{ width: `${gaugePct}%` }}
                        />
                        <div
                          className="gauge-threshold-marker"
                          style={{
                            left: `${Math.min(95, (sensor.alert_distance_m / sensor.visual_range_m) * 100)}%`,
                          }}
                          title={`Alert distance: ${sensor.alert_distance_m.toFixed(2)} m`}
                        />
                      </div>
                    )}
                  </div>

                  <div className="spatial-range-value">
                    <strong
                      className={
                        isAlert
                          ? "range-text-alert"
                          : isCaution
                            ? "range-text-caution"
                            : ""
                      }
                    >
                      {reading?.is_valid
                        ? `${formatNumber(reading.range_m, 2)} m`
                        : "Unknown"}
                    </strong>
                    <small>
                      {sensor.scanner
                        ? `${formatNumber(latestReading?.angle_deg ?? Number.NaN, 0)}° head · ${formatNumber(sensor.display_pose.pitch_deg, 0)}° pitch`
                        : `${formatNumber(sensor.display_pose.yaw_deg, 0)}° yaw · ${formatNumber(sensor.display_pose.pitch_deg, 0)}° pitch`}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>

          <dl className="spatial-summary-list">
            <div>
              <dt>Mapped dots</dt>
              <dd>{plottedPoints.length}</dd>
            </div>
            <div>
              <dt>Nearest obstacle</dt>
              <dd className={closestAlert ? "text-danger" : ""}>
                {nearestAnyReading?.rangeM !== null &&
                nearestAnyReading?.rangeM !== undefined
                  ? `${nearestAnyReading.rangeM.toFixed(2)} m`
                  : "--"}
              </dd>
            </div>
            <div>
              <dt>MPU-6050 Heading</dt>
              <dd>{connected ? `${formatNumber(imuHeading, 0)}°` : "--"}</dd>
            </div>
            <div>
              <dt>MPU-6050 Yaw Rate</dt>
              <dd>{connected ? `${formatNumber(imuYawRate, 1)}°/s` : "--"}</dd>
            </div>
            <div>
              <dt>Vehicle Speed</dt>
              <dd>
                {connected
                  ? `${formatNumber(vehicle.speed_mps * 3.6, 1)} km/h`
                  : "--"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
      <NavigationMap world={world} vehicle={vehicle} connected={connected} />
    </section>
  );
}
