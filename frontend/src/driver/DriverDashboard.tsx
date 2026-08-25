import { CameraAwareness } from "./CameraAwareness";
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
  const corridorState = telemetryConnected ? world.safe_corridor.state : "GREY";

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
        />

        <aside className="driver-instruments">
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

          <div className="driver-metric-grid">
            <article>
              <span>Nearest obstacle</span>
              <strong>{nearest === null ? "--" : `${formatNumber(nearest, 2)} m`}</strong>
            </article>
            <article>
              <span>Safe corridor</span>
              <strong className={`corridor-${corridorState.toLowerCase()}`}>
                {corridorState}
              </strong>
            </article>
            <article>
              <span>Stop system</span>
              <strong className={telemetryConnected ? `emergency-${emergencyClass}` : "corridor-grey"}>
                {telemetryConnected ? world.emergency.state.replaceAll("_", " ") : "UNAVAILABLE"}
              </strong>
            </article>
          </div>

          <ProximityWidget
            points={points}
            vehicle={vehicle}
            validReadingCount={ranges.length}
          />
        </aside>
      </div>
    </section>
  );
}
