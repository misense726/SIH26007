import { useEffect, useState } from "react";
import { CameraAwareness } from "./CameraAwareness";
import { CampusExtendedMapModal } from "./CampusExtendedMapModal";
import { ProximityWidget } from "./ProximityWidget";
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
  );
  const emergencyClass = world.emergency.state.toLowerCase().replace("_", "-");
  const emergencyControlState = !vehicleTelemetryAvailable
    ? "UNVERIFIED"
    : world.emergency.motor_cut
      ? "MOTOR CUT"
      : world.emergency.state === "EMERGENCY_STOP"
        ? "STOP REQUEST"
        : world.emergency.state === "SAFE"
          ? "NO STOP REQUEST"
          : world.emergency.state;
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
      ) : world.emergency.state !== "SAFE" && (
        <div className={`emergency-banner emergency-banner-${emergencyClass}`} role="alert">
          <strong>{world.emergency.state.replaceAll("_", " ")}</strong>
          <span>{world.emergency.reason ?? "Reduce speed and check the safe corridor."}</span>
        </div>
      )}

      <div className="driver-grid">
        <CameraAwareness
          world={world}
          readings={ranges}
          points={points}
          vehicle={vehicle}
          sensorSettings={sensorSettings}
          mode={awarenessMode}
          onModeChange={onAwarenessModeChange}
          connection={driverConnection}
          onExpandMap={() => setIsMapExtended(true)}
        />

        <aside className="driver-instruments">
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
