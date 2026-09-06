import { availableRangeReadings } from "../state/rangeReadings";
import {
  nearestRange,
  tofSensorHealth,
  tofSensorHealthSummary,
} from "../state/selectors";
import type {
  AlertEvent,
  EmergencyLevel,
  SensorHealth,
  V2XPeerNode,
  WorldState,
} from "../types";

export type SupervisorVehicleTone =
  | "nominal"
  | "attention"
  | "critical"
  | "lost"
  | "unknown";

export interface SupervisorVehicle {
  vehicleId: string;
  isPrimary: boolean;
  isSimulated: boolean;
  sourceLabel: string;
  xM: number;
  yM: number;
  headingDeg: number;
  speedMps: number;
  positionConfidence: number | null;
  emergencyState: string | null;
  linkStatus: V2XPeerNode["link_status"] | null;
  distanceM: number | null;
  lastUpdateMs: number;
  ageMs: number;
  tone: SupervisorVehicleTone;
}

export interface SupervisorIssue {
  id: string;
  severity: "WARNING" | "CRITICAL";
  kind: "SAFETY" | "CONNECTIVITY" | "SENSOR" | "VISIBILITY";
  vehicleId: string;
  title: string;
  detail: string;
}

export interface PrimaryTelemetrySummary {
  vehicle: SupervisorVehicle;
  visibilityPercent: number;
  visibilityState: WorldState["environment"]["visibility_state"];
  temperatureC: number;
  pressureHpa: number;
  relativeAltitudeM: number;
  nearestObstacleM: number | null;
  corridorState: WorldState["safe_corridor"]["state"];
  corridorConfidence: number;
  corridorReason: string;
  sensors: SensorHealth[];
  sensorSummary: ReturnType<typeof tofSensorHealthSummary>;
}

export interface SupervisorViewModel {
  mapName: string;
  referenceTimeMs: number;
  mode: WorldState["mode"];
  vehicles: SupervisorVehicle[];
  counts: {
    total: number;
    online: number;
    nominal: number;
    attention: number;
    critical: number;
    lost: number;
    unknown: number;
  };
  issues: SupervisorIssue[];
  history: AlertEvent[];
  primary: PrimaryTelemetrySummary | null;
}

const UNSAFE_RANK: Record<string, number> = {
  EMERGENCY_STOP: 4,
  CRITICAL: 3,
  WARNING: 2,
  SAFE: 1,
};

const TONE_RANK: Record<SupervisorVehicleTone, number> = {
  critical: 5,
  lost: 4,
  attention: 3,
  unknown: 2,
  nominal: 1,
};

function normalizedEmergencyState(state: string | null | undefined): string | null {
  return state ? state.toUpperCase() : null;
}

function vehicleTone(
  emergencyState: string | null,
  linkStatus: V2XPeerNode["link_status"] | null,
  isPrimary: boolean,
  primarySensorsDegraded: boolean,
  primaryVisibilityDegraded: boolean,
): SupervisorVehicleTone {
  if (linkStatus === "LOST") return "lost";

  const emergencyRank = emergencyState ? (UNSAFE_RANK[emergencyState] ?? 3) : 0;
  if (emergencyRank >= UNSAFE_RANK.CRITICAL) return "critical";
  if (
    emergencyRank === UNSAFE_RANK.WARNING ||
    linkStatus === "DEGRADED" ||
    (isPrimary && (primarySensorsDegraded || primaryVisibilityDegraded))
  ) {
    return "attention";
  }
  if (!emergencyState && !isPrimary) return "unknown";
  return "nominal";
}

function issueForVehicle(vehicle: SupervisorVehicle): SupervisorIssue | null {
  const emergency = normalizedEmergencyState(vehicle.emergencyState);
  if (emergency && emergency !== "SAFE") {
    const critical = emergency === "CRITICAL" || emergency === "EMERGENCY_STOP";
    return {
      id: `safety-${vehicle.vehicleId}-${emergency}`,
      severity: critical ? "CRITICAL" : "WARNING",
      kind: "SAFETY",
      vehicleId: vehicle.vehicleId,
      title: emergency.replaceAll("_", " "),
      detail: critical
        ? "The vehicle reports an immediate safety intervention."
        : "The vehicle reports a safety condition that needs review.",
    };
  }
  if (vehicle.linkStatus === "LOST") {
    return {
      id: `link-lost-${vehicle.vehicleId}`,
      severity: "WARNING",
      kind: "CONNECTIVITY",
      vehicleId: vehicle.vehicleId,
      title: "Vehicle contact lost",
      detail: "The simulated V2X peer is no longer reporting a current position.",
    };
  }
  if (vehicle.linkStatus === "DEGRADED") {
    return {
      id: `link-degraded-${vehicle.vehicleId}`,
      severity: "WARNING",
      kind: "CONNECTIVITY",
      vehicleId: vehicle.vehicleId,
      title: "Vehicle link degraded",
      detail: "Coordination data may arrive late or intermittently.",
    };
  }
  return null;
}

export function createSupervisorViewModel(world: WorldState): SupervisorViewModel {
  const referenceTimeMs = Math.max(
    world.generated_at_ms,
    world.v2x?.timestamp_ms ?? 0,
    ...world.vehicles.map((vehicle) => vehicle.timestamp_ms),
  );
  const peers = world.v2x?.active_peers ?? [];
  const peersById = new Map(peers.map((peer) => [peer.vehicle_id, peer]));
  const tofSensors = tofSensorHealth(world.sensor_health);
  const sensorSummary = tofSensorHealthSummary(world.sensor_health);
  const primarySensorsDegraded = sensorSummary.healthy < sensorSummary.total;
  const primaryVisibilityDegraded =
    world.environment.visibility_state === "LOW" ||
    world.environment.visibility_state === "VERY_LOW";

  const vehicles: SupervisorVehicle[] = world.vehicles.map((vehicle) => {
    const peer = peersById.get(vehicle.vehicle_id);
    const isPrimary = vehicle.vehicle_id === world.primary_vehicle_id;
    const emergencyState = normalizedEmergencyState(
      isPrimary ? world.emergency.state : peer?.emergency_state,
    );
    const linkStatus = peer?.link_status ?? null;
    const lastUpdateMs = Math.max(vehicle.timestamp_ms, peer?.last_seen_ms ?? 0);

    return {
      vehicleId: vehicle.vehicle_id,
      isPrimary,
      isSimulated: vehicle.mode === "SIMULATED",
      sourceLabel: isPrimary
        ? "Primary telemetry"
        : peer
          ? "Vehicle + V2X"
          : "Vehicle telemetry",
      xM: vehicle.x_m,
      yM: vehicle.y_m,
      headingDeg: vehicle.heading_deg,
      speedMps: vehicle.speed_mps,
      positionConfidence: vehicle.position_confidence,
      emergencyState,
      linkStatus,
      distanceM: peer?.distance_m ?? null,
      lastUpdateMs,
      ageMs: Math.max(0, referenceTimeMs - lastUpdateMs),
      tone: vehicleTone(
        emergencyState,
        linkStatus,
        isPrimary,
        primarySensorsDegraded,
        primaryVisibilityDegraded,
      ),
    };
  });

  const canonicalIds = new Set(vehicles.map((vehicle) => vehicle.vehicleId));
  peers.forEach((peer) => {
    if (canonicalIds.has(peer.vehicle_id)) return;
    const emergencyState = normalizedEmergencyState(peer.emergency_state);
    vehicles.push({
      vehicleId: peer.vehicle_id,
      isPrimary: false,
      isSimulated: true,
      sourceLabel: "V2X simulation",
      xM: peer.x_m,
      yM: peer.y_m,
      headingDeg: peer.heading_deg,
      speedMps: peer.speed_mps,
      positionConfidence: null,
      emergencyState,
      linkStatus: peer.link_status,
      distanceM: peer.distance_m,
      lastUpdateMs: peer.last_seen_ms,
      ageMs: Math.max(0, referenceTimeMs - peer.last_seen_ms),
      tone: vehicleTone(emergencyState, peer.link_status, false, false, false),
    });
  });

  vehicles.sort((left, right) => {
    const toneDifference = TONE_RANK[right.tone] - TONE_RANK[left.tone];
    if (toneDifference !== 0) return toneDifference;
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    return left.vehicleId.localeCompare(right.vehicleId);
  });

  const issues = vehicles
    .map(issueForVehicle)
    .filter((issue): issue is SupervisorIssue => issue !== null);

  if (primarySensorsDegraded) {
    issues.push({
      id: "primary-sensor-health",
      severity: sensorSummary.healthy === 0 ? "CRITICAL" : "WARNING",
      kind: "SENSOR",
      vehicleId: world.primary_vehicle_id,
      title: "Range sensor coverage reduced",
      detail: `${sensorSummary.healthy} of ${sensorSummary.total} ToF sensors report healthy.`,
    });
  }

  if (world.environment.visibility_state === "LOW" || world.environment.visibility_state === "VERY_LOW") {
    issues.push({
      id: "primary-visibility",
      severity: world.environment.visibility_state === "VERY_LOW" ? "CRITICAL" : "WARNING",
      kind: "VISIBILITY",
      vehicleId: world.primary_vehicle_id,
      title: `${world.environment.visibility_state.replaceAll("_", " ")} visibility`,
      detail: `Primary vehicle visibility is ${Math.round(world.environment.visibility_score * 100)}%.`,
    });
  }

  const haul = world.haul_route;
  if (haul && (haul.obstacle_detected || haul.traffic_slowing || haul.lead_waiting)) {
    issues.push({
      id: "haul-encounter",
      severity: "WARNING",
      kind: "SAFETY",
      vehicleId: world.primary_vehicle_id,
      title: haul.next_instruction,
      detail: haul.obstacle_detected ? "Range-confirmed rock on the assigned track." : "Vehicle coordination on the haul track.",
    });
  }
  issues.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "CRITICAL" ? -1 : 1;
    return left.vehicleId.localeCompare(right.vehicleId);
  });

  const primaryVehicle = vehicles.find((vehicle) => vehicle.isPrimary) ?? null;
  const primary = primaryVehicle
    ? {
        vehicle: primaryVehicle,
        visibilityPercent: Math.round(world.environment.visibility_score * 100),
        visibilityState: world.environment.visibility_state,
        temperatureC: world.environment.temperature_c,
        pressureHpa: world.environment.pressure_hpa,
        relativeAltitudeM: world.environment.relative_altitude_m,
        nearestObstacleM: nearestRange(
          availableRangeReadings(world.ranges, world.sensor_health, true),
        ),
        corridorState: world.safe_corridor.state,
        corridorConfidence: world.safe_corridor.confidence,
        corridorReason: world.safe_corridor.reason,
        sensors: tofSensors,
        sensorSummary,
      }
    : null;

  return {
    mapName: world.reference_map?.name ?? "Reference map unavailable",
    referenceTimeMs,
    mode: world.mode,
    vehicles,
    counts: {
      total: vehicles.length,
      online: vehicles.filter((vehicle) => vehicle.tone !== "lost").length,
      nominal: vehicles.filter((vehicle) => vehicle.tone === "nominal").length,
      attention: vehicles.filter((vehicle) => vehicle.tone === "attention").length,
      critical: vehicles.filter((vehicle) => vehicle.tone === "critical").length,
      lost: vehicles.filter((vehicle) => vehicle.tone === "lost").length,
      unknown: vehicles.filter((vehicle) => vehicle.tone === "unknown").length,
    },
    issues,
    history: [...world.alerts].sort((left, right) => right.timestamp_ms - left.timestamp_ms),
    primary,
  };
}
