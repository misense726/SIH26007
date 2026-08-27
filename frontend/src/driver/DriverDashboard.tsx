import { useState } from "react";
import { CameraAwareness } from "./CameraAwareness";
import { CampusExtendedMapModal } from "./CampusExtendedMapModal";
import { ProximityWidget } from "./ProximityWidget";
import type { AwarenessMode } from "./driverAwareness";
import { availableRangeReadings } from "../state/rangeReadings";
import { availableSpatialPoints } from "../state/spatialPoints";
import { formatNumber, nearestRange, primaryVehicle } from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import type { WorldState } from "../types";

interface DriverDashboardProps {
  world: WorldState;
  awarenessMode: AwarenessMode;
  onAwarenessModeChange: (mode: AwarenessMode) => void;
  connection: ConnectionState;
}

export function DriverDashboard({
  world,
  awarenessMode,
  onAwarenessModeChange,
  connection,
}: DriverDashboardProps) {
  const [isMapExtended, setIsMapExtended] = useState(false);
  const telemetryConnected = connection === "CONNECTED";
  const vehicle = primaryVehicle(world);
  const ranges = availableRangeReadings(
    world.ranges,
    world.sensor_health,
    telemetryConnected,
  );
  const nearest = nearestRange(ranges);
  const points = availableSpatialPoints(
    world.spatial_points,
    world.sensor_health,
    telemetryConnected,
    world.generated_at_ms,
    vehicle,
  );
  const emergencyClass = world.emergency.state.toLowerCase().replace("_", "-");
  const compactStopState = !telemetryConnected
    ? "OFFLINE"
    : world.emergency.state === "EMERGENCY_STOP"
      ? "STOPPED"
      : world.emergency.state;
  const corridorState = telemetryConnected ? world.safe_corridor.state : "GREY";
  const corridorConfidence = telemetryConnected
    ? Math.round(world.safe_corridor.confidence * 100)
    : 0;

  return (
    <section className="dashboard driver-dashboard" aria-label="Driver dashboard">
      {!telemetryConnected ? (
        <div
          className="emergency-banner telemetry-banner"
          role={connection === "DISCONNECTED" ? "alert" : "status"}
          aria-live={connection === "DISCONNECTED" ? "assertive" : "polite"}
        >
          <strong>{connection === "CONNECTING" ? "CONNECTING" : "TELEMETRY LOST"}</strong>
          <span>
            {connection === "CONNECTING"
              ? "Waiting for live vehicle and sensor data."
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
          mode={awarenessMode}
          onModeChange={onAwarenessModeChange}
          connection={connection}
          onExpandMap={() => setIsMapExtended(true)}
        />

        <aside className="driver-instruments">
          {/* Top-Right Safe Corridor Primary Status Card */}
          <article className={`safe-corridor-top-card corridor-card-${corridorState.toLowerCase()}`}>
            <div className="corridor-card-header">
              <div>
                <p className="eyebrow">Corridor Clearance</p>
                <h3>Safe Corridor</h3>
              </div>
              <span className="corridor-confidence-badge">
                {telemetryConnected ? `${corridorConfidence}% Conf.` : "No Telemetry"}
              </span>
            </div>
            <div className="corridor-card-body">
              <strong className={`corridor-state-pill corridor-${corridorState.toLowerCase()}`}>
                {corridorState}
              </strong>
              <p className="corridor-card-detail">
                {corridorState === "GREEN" && "Optimal lane clearance. Path is unobstructed."}
                {corridorState === "YELLOW" && "Caution: Proximity alert or boundary restriction."}
                {corridorState === "RED" && "Danger: Hazard zone or obstacle in path. Brake now."}
                {corridorState === "GREY" && "Corridor evaluation inactive or sensors degraded."}
              </p>
            </div>
          </article>

          {/* Vehicle Speed & Heading */}
          <article className="speed-card">
            <p className="eyebrow">Vehicle speed</p>
            <div className="speed-readout">
              <strong>{telemetryConnected ? formatNumber(vehicle.speed_mps * 3.6, 1) : "--"}</strong>
              <span>km/h</span>
            </div>
            <div className="speed-meta">
              <span>Heading</span>
              <strong>{telemetryConnected ? `${formatNumber(vehicle.heading_deg, 0)}°` : "--"}</strong>
            </div>
          </article>

          {/* Metrics Grid */}
          <div className="driver-metric-grid">
            <article>
              <span>Nearest obstacle</span>
              <strong>{nearest === null ? "--" : `${formatNumber(nearest, 2)} m`}</strong>
            </article>
            <article>
              <span>Stop system</span>
              <strong className={telemetryConnected ? `emergency-${emergencyClass}` : "corridor-grey"}>
                {compactStopState}
              </strong>
            </article>
          </div>

          {/* 360° Proximity Radar Widget */}
          <ProximityWidget
            points={points}
            vehicle={vehicle}
            validReadingCount={ranges.length}
          />
        </aside>
      </div>

      {/* Extended Campus Map View Modal (Bigger Box) */}
      {isMapExtended && (
        <CampusExtendedMapModal
          world={world}
          vehicle={vehicle}
          telemetryConnected={telemetryConnected}
          onClose={() => setIsMapExtended(false)}
        />
      )}
    </section>
  );
}
