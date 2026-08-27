import { SensorHealthList } from "../components/SensorHealthList";
import { availableRangeReadings } from "../state/rangeReadings";
import {
  formatNumber,
  nearestRange,
  tofSensorHealth,
  tofSensorHealthSummary,
} from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import { TwinMap } from "../twin/TwinMap";
import type { WorldState } from "../types";
import { FleetCard } from "./FleetCard";
import { V2XPanel } from "./V2XPanel";

interface SupervisorDashboardProps {
  world: WorldState;
  connection: ConnectionState;
}

export function SupervisorDashboard({ world, connection }: SupervisorDashboardProps) {
  if (connection !== "CONNECTED") {
    const connecting = connection === "CONNECTING";

    return (
      <section className="dashboard supervisor-dashboard" aria-label="Supervisor dashboard">
        <div className="supervisor-summary">
          <div>
            <p className="eyebrow">Fleet operations</p>
            <h2>Telemetry unavailable</h2>
          </div>
          <div className="summary-metrics">
            <span><strong>--</strong> active</span>
            <span><strong>--</strong> alerts</span>
            <span><strong>--</strong> visibility</span>
          </div>
        </div>
        <div
          className="emergency-banner telemetry-banner"
          role={connecting ? "status" : "alert"}
          aria-live={connecting ? "polite" : "assertive"}
        >
          <strong>{connecting ? "CONNECTING" : "TELEMETRY LOST"}</strong>
          <span>
            {connecting
              ? "Waiting for live fleet data."
              : "Live fleet, environment, and safety data are unavailable."}
          </span>
        </div>
        <article className="operations-card supervisor-unavailable-card">
          <p className="eyebrow">Fleet data</p>
          <h2>{connecting ? "Opening telemetry" : "Waiting for telemetry"}</h2>
          <p>Current data will appear when the connection is available.</p>
        </article>
      </section>
    );
  }

  const nearest = nearestRange(
    availableRangeReadings(world.ranges, world.sensor_health, true),
  );
  const activeAlerts = world.emergency.state === "SAFE" ? 0 : 1;
  const tofSensors = tofSensorHealth(world.sensor_health);
  const sensorSummary = tofSensorHealthSummary(world.sensor_health);

  return (
    <section className="dashboard supervisor-dashboard" aria-label="Supervisor dashboard">
      <div className="supervisor-summary">
        <div>
          <p className="eyebrow">Fleet operations</p>
          <h2>{world.reference_map?.name ?? "Reference map unavailable"}</h2>
        </div>
        <div className="summary-metrics">
          <span><strong>{world.vehicles.length}</strong> active</span>
          <span><strong>{activeAlerts}</strong> alerts</span>
          <span><strong>{Math.round(world.environment.visibility_score * 100)}%</strong> visibility</span>
        </div>
      </div>

      <div className="supervisor-grid">
        <article className="fleet-map-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live location</p>
              <h2>Fleet map</h2>
            </div>
            <span className="source-badge">{world.mode}</span>
          </div>
          <TwinMap world={world} />
        </article>

        <aside className="fleet-column">
          {world.vehicles.map((vehicle) => (
            <FleetCard
              key={vehicle.vehicle_id}
              vehicle={vehicle}
              environment={world.environment}
              emergency={world.emergency}
              sensors={world.sensor_health}
            />
          ))}
        </aside>
      </div>

      <div className="supervisor-lower-grid">
        <article className="operations-card environment-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Vehicle environment</p>
              <h2>Conditions</h2>
            </div>
            <span className="source-badge">BMP280 + camera</span>
          </div>
          <div className="condition-grid">
            <div><span>Temperature</span><strong>{formatNumber(world.environment.temperature_c)}°C</strong></div>
            <div><span>Pressure</span><strong>{formatNumber(world.environment.pressure_hpa)} hPa</strong></div>
            <div><span>Relative altitude</span><strong>{formatNumber(world.environment.relative_altitude_m, 2)} m</strong><small>approximate</small></div>
            <div><span>Visibility</span><strong>{world.environment.visibility_state.replaceAll("_", " ")}</strong></div>
            <div><span>Nearest obstacle</span><strong>{nearest === null ? "--" : `${formatNumber(nearest, 2)} m`}</strong></div>
            <div><span>Map confidence</span><strong>{Math.round(world.safe_corridor.confidence * 100)}%</strong></div>
          </div>
        </article>

        <article className="operations-card sensors-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Acquisition status</p>
              <h2>Range sensors</h2>
            </div>
            <span className="source-badge">{sensorSummary.total} ToF sensors</span>
          </div>
          <SensorHealthList sensors={tofSensors} />
        </article>

        <article className="operations-card alerts-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Safety events</p>
              <h2>Alert log</h2>
            </div>
            <span className={`alert-count ${activeAlerts > 0 ? "alert-count-active" : ""}`}>
              {activeAlerts}
            </span>
          </div>
          {activeAlerts === 0 ? (
            <div className="alerts-empty">
              <span className="alerts-check">✓</span>
              <strong>No active alerts</strong>
              <small>Monitoring active.</small>
            </div>
          ) : (
            <div className="active-alert" role="alert">
              <strong>{world.emergency.state.replaceAll("_", " ")}</strong>
              <span>{world.emergency.reason ?? "Unsafe vehicle condition detected."}</span>
            </div>
          )}
        </article>
      </div>

      <V2XPanel v2x={world.v2x} />
    </section>
  );
}
