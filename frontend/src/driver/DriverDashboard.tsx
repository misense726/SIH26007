import { useEffect, useRef, useState } from "react";
import { CameraAwareness } from "./CameraAwareness";
import { CampusExtendedMapModal } from "./CampusExtendedMapModal";
import { DriverGuidanceHUD } from "./DriverGuidanceHUD";
import { activeProximityAlerts, ProximityWidget } from "./ProximityWidget";
import type { AwarenessMode } from "./driverAwareness";
import { availableRangeReadings } from "../state/rangeReadings";
import { availableSpatialPoints } from "../state/spatialPoints";
import {
  formatNumber,
  nearestRange,
  primaryVehicle,
  primaryVehicleOrNull,
  TOF_SENSOR_IDS,
} from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import type { WorldState } from "../types";
import { selectSimulatedForwardHazard, type ForwardHazard } from "../spatial/forwardHazard";

interface DriverDashboardProps {
  world: WorldState;
  awarenessMode: AwarenessMode;
  onAwarenessModeChange: (mode: AwarenessMode) => void;
  connection: ConnectionState;
  sensorSettings: SensorDisplaySetting[];
}

export function DriverDashboard({
  world,
  awarenessMode,
  onAwarenessModeChange,
  connection,
  sensorSettings,
}: DriverDashboardProps) {
  const [isMapExtended, setIsMapExtended] = useState(false);
  const forwardRef = useRef<ForwardHazard | null>(null);
  const telemetryConnected = connection === "CONNECTED";
  const reportedVehicle = primaryVehicleOrNull(world);
  const vehicle = reportedVehicle ?? primaryVehicle(world);
  const vehicleTelemetryAvailable = telemetryConnected && reportedVehicle !== null;
  const driverConnection: ConnectionState = telemetryConnected && reportedVehicle === null
    ? "DISCONNECTED"
    : connection;
  const ranges = availableRangeReadings(
    world.ranges,
    world.sensor_health,
    vehicleTelemetryAvailable,
  );
  const nearest = nearestRange(ranges);
  const points = availableSpatialPoints(
    world.spatial_points,
    world.sensor_health,
    vehicleTelemetryAvailable,
    world.generated_at_ms,
    vehicle,
    undefined,
    sensorSettings,
  );
  const nearestProximityAlert = world.mode === "LIVE"
    ? activeProximityAlerts(ranges, sensorSettings)[0] : null;
  const forward = vehicleTelemetryAvailable
    ? selectSimulatedForwardHazard(world, vehicle, forwardRef.current) : null;
  forwardRef.current = forward;
  const displayEmergencyState = world.mode === "SIMULATED" && world.emergency.state !== "EMERGENCY_STOP"
    ? forward ? forward.distance_m < 1.5 ? "CRITICAL" : "WARNING" : "SAFE"
    : world.emergency.state;
  const displayEmergencyReason = world.mode === "SIMULATED" && forward && displayEmergencyState !== "EMERGENCY_STOP"
    ? forward.detail : world.emergency.reason;
  const emergencyClass = displayEmergencyState.toLowerCase().replace("_", "-");
  const emergencyControlState = !vehicleTelemetryAvailable
    ? "UNVERIFIED"
    : world.emergency.motor_cut
      ? "MOTOR CUT"
      : displayEmergencyState === "EMERGENCY_STOP"
        ? "STOP REQUEST"
        : displayEmergencyState === "SAFE"
          ? "NO STOP REQUEST"
          : displayEmergencyState;
  const trustedSensorIds = new Set(ranges.map((reading) => reading.sensor_id));
  const hasCompleteRangeCoverage = TOF_SENSOR_IDS.every((sensorId) => trustedSensorIds.has(sensorId));
  const corridorState = vehicleTelemetryAvailable && hasCompleteRangeCoverage
    ? world.safe_corridor.state
    : "GREY";
  const corridorConfidence = vehicleTelemetryAvailable
    ? Math.round(world.safe_corridor.confidence * 100)
    : 0;
  const corridorLabel = corridorState === "GREY" ? "UNVERIFIED" : corridorState;

  useEffect(() => {
    if (!vehicleTelemetryAvailable) setIsMapExtended(false);
  }, [vehicleTelemetryAvailable]);

  return (
    <section className="dashboard driver-dashboard" aria-label="Driver dashboard">
      {!vehicleTelemetryAvailable ? (
        <div
          className="emergency-banner telemetry-banner"
          role={connection === "CONNECTING" ? "status" : "alert"}
          aria-live={connection === "CONNECTING" ? "polite" : "assertive"}
        >
          <strong>
            {connection === "CONNECTING"
              ? "CONNECTING"
              : telemetryConnected
                ? "VEHICLE DATA MISSING"
                : "TELEMETRY LOST"}
          </strong>
          <span>
            {connection === "CONNECTING"
              ? "Waiting for live vehicle and sensor data."
              : telemetryConnected
                ? "No primary vehicle was reported."
                : "Live vehicle and sensor data are unavailable."}
          </span>
        </div>
      ) : displayEmergencyState !== "SAFE" ? (
        <div className={`emergency-banner emergency-banner-${emergencyClass} ${world.mode === "SIMULATED" && displayEmergencyState === "WARNING" ? "simulated-warning-banner" : ""}`} role="alert">
          <strong>{displayEmergencyState === "EMERGENCY_STOP" ? "EMERGENCY STOP"
            : forward?.title ?? displayEmergencyState.replaceAll("_", " ")}</strong>
          <span>{displayEmergencyReason ?? "Reduce speed and check the safe corridor."}</span>
        </div>
      ) : nearestProximityAlert && (
        <div className="emergency-banner emergency-banner-critical" role="alert" aria-live="assertive">
          <strong>PROXIMITY ALERT</strong>
          <span>{nearestProximityAlert.sensor.label}: {nearestProximityAlert.reading.range_m.toFixed(2)} m</span>
        </div>
      )}

      <div className="driver-grid">
        <CameraAwareness
          world={world}
          vehicle={vehicle}
          mode={awarenessMode}
          onModeChange={onAwarenessModeChange}
          connection={driverConnection}
          onExpandMap={() => setIsMapExtended(true)}
        />

        <aside className="driver-instruments">
          <DriverGuidanceHUD
            world={world}
            vehicleTelemetryAvailable={vehicleTelemetryAvailable}
          />

          <article className={`safe-corridor-top-card corridor-card-${corridorState.toLowerCase()}`}>
            <div className="corridor-card-header">
              <div>
                <p className="eyebrow">Route status</p>
                <h3>Safe corridor</h3>
              </div>
              <span
                className="corridor-confidence-badge"
                aria-label={vehicleTelemetryAvailable ? `Corridor confidence ${corridorConfidence}%` : "No telemetry"}
              >
                {!vehicleTelemetryAvailable
                  ? "OFFLINE"
                  : hasCompleteRangeCoverage
                    ? `${corridorConfidence}%`
                    : `${trustedSensorIds.size}/${TOF_SENSOR_IDS.length} SENSORS`}
              </span>
            </div>
            <div className="corridor-card-body">
              <strong className={`corridor-state-pill corridor-${corridorState.toLowerCase()}`}>
                {corridorLabel}
              </strong>
              <p className="corridor-card-detail">
                {corridorState === "GREEN" && "Path clear"}
                {corridorState === "YELLOW" && "Reduce speed"}
                {corridorState === "RED" && "Stop"}
                {corridorState === "GREY" && "Sensor coverage incomplete"}
              </p>
            </div>
          </article>

          <article className="speed-card">
            <p className="eyebrow">Vehicle speed</p>
            <div className="speed-readout">
              <strong>{vehicleTelemetryAvailable ? formatNumber(vehicle.speed_mps * 3.6, 1) : "--"}</strong>
              <span>km/h</span>
            </div>
            <div className="speed-meta">
              <span>Heading</span>
              <strong>{vehicleTelemetryAvailable ? `${formatNumber(vehicle.heading_deg, 0)}°` : "--"}</strong>
            </div>
          </article>

          <div className="driver-metric-grid">
            <article>
              <span>Nearest obstacle</span>
              <strong>{nearest === null ? "--" : `${formatNumber(nearest, 2)} m`}</strong>
            </article>
            <article>
              <span>Emergency control</span>
              <strong className={vehicleTelemetryAvailable ? `emergency-${emergencyClass}` : "corridor-grey"}>
                {emergencyControlState}
              </strong>
            </article>
          </div>

          <ProximityWidget
            points={points}
            vehicle={vehicle}
            readings={ranges}
            sensorHealth={world.sensor_health}
            sensorSettings={sensorSettings}
            telemetryConnected={vehicleTelemetryAvailable}
          />
        </aside>
      </div>

      {isMapExtended && vehicleTelemetryAvailable && (
        <CampusExtendedMapModal
          world={world}
          vehicle={vehicle}
          telemetryConnected={vehicleTelemetryAvailable}
          onClose={() => setIsMapExtended(false)}
        />
      )}
    </section>
  );
}
