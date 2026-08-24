import { CameraAwareness } from "./CameraAwareness";
import { ProximityWidget } from "./ProximityWidget";
import { formatNumber, nearestRange, primaryVehicle } from "../state/selectors";
import type { WorldState } from "../types";

export function DriverDashboard({ world }: { world: WorldState }) {
  const vehicle = primaryVehicle(world);
  const nearest = nearestRange(world.ranges);
  const emergencyClass = world.emergency.state.toLowerCase().replace("_", "-");
  const guidanceTitle = {
    GREEN: "Proceed in safe corridor",
    YELLOW: "Reduce speed and monitor",
    RED: "Stop before blocked corridor",
    GREY: "Corridor verification pending",
  }[world.safe_corridor.state];

  return (
    <section className="dashboard driver-dashboard" aria-label="Driver dashboard">
      {world.emergency.state !== "SAFE" && (
        <div className={`emergency-banner emergency-banner-${emergencyClass}`} role="alert">
          <strong>{world.emergency.state.replaceAll("_", " ")}</strong>
          <span>{world.emergency.reason ?? "Reduce speed and check the safe corridor."}</span>
        </div>
      )}

      <div className="driver-grid">
        <CameraAwareness world={world} />

        <aside className="driver-instruments">
          <article className="speed-card">
            <p className="eyebrow">Vehicle speed</p>
            <div className="speed-readout">
              <strong>{formatNumber(vehicle.speed_mps * 3.6, 1)}</strong>
              <span>km/h</span>
            </div>
            <div className="speed-meta">
              <span>Heading</span>
              <strong>{formatNumber(vehicle.heading_deg, 0)}°</strong>
            </div>
          </article>

          <div className="driver-metric-grid">
            <article>
              <span>Nearest obstacle</span>
              <strong>{nearest === null ? "--" : `${formatNumber(nearest, 2)} m`}</strong>
            </article>
            <article>
              <span>Visibility</span>
              <strong>{world.environment.visibility_state.replace("_", " ")}</strong>
            </article>
            <article>
              <span>Safe corridor</span>
              <strong className={`corridor-${world.safe_corridor.state.toLowerCase()}`}>
                {world.safe_corridor.state}
              </strong>
            </article>
            <article>
              <span>Stop system</span>
              <strong className={`emergency-${emergencyClass}`}>{world.emergency.state.replace("_", " ")}</strong>
            </article>
          </div>
        </aside>
      </div>

      <div className="driver-lower-grid">
        <ProximityWidget readings={world.ranges} />
        <article className="route-guidance-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Route guidance</p>
              <h2>{guidanceTitle}</h2>
            </div>
            <span className={`corridor-dot corridor-dot-${world.safe_corridor.state.toLowerCase()}`} />
          </div>
          <div className="guidance-lane" aria-hidden="true">
            <span className="guidance-path" />
            <span className="guidance-vehicle" />
          </div>
          <dl className="guidance-details">
            <div><dt>Position confidence</dt><dd>{Math.round(vehicle.position_confidence * 100)}%</dd></div>
            <div><dt>Active route</dt><dd>{world.reference_map?.name ?? "Unavailable"}</dd></div>
            <div><dt>Range sensors</dt><dd>{world.sensor_health.length || 0} reporting</dd></div>
          </dl>
        </article>
      </div>
    </section>
  );
}
