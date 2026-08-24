import { useMemo } from "react";
import { useTelemetry } from "./state/useTelemetry";
import "./styles.css";

function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

export default function App() {
  const { world, connection } = useTelemetry();
  const nearestRange = useMemo(
    () =>
      world.ranges.length > 0
        ? Math.min(...world.ranges.map((reading) => reading.range_m))
        : null,
    [world.ranges],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            FS
          </span>
          <div>
            <p className="eyebrow">Mine vehicle awareness</p>
            <h1>FogSen control room</h1>
          </div>
        </div>
        <div className="status-row">
          <span className={`connection connection-${connection.toLowerCase()}`}>
            {connection}
          </span>
          <span className="mode-pill">{world.mode}</span>
        </div>
      </header>

      <section className="hero-grid" aria-label="Live FogSen telemetry">
        <article className="camera-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Driver view</p>
              <h2>Camera feed placeholder</h2>
            </div>
            <span className="feed-label">SIMULATED</span>
          </div>
          <div className="camera-placeholder">
            <div className="road road-left" />
            <div className="road road-right" />
            <div className="center-guide" />
            <p>Pi camera provider is not connected</p>
          </div>
        </article>

        <aside className="vehicle-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Active vehicle</p>
              <h2>{world.vehicle.vehicle_id}</h2>
            </div>
            <span className="sequence">#{world.sequence}</span>
          </div>
          <div className="speed-readout">
            <strong>{formatNumber(world.vehicle.speed_mps * 3.6, 1)}</strong>
            <span>km/h</span>
          </div>
          <dl className="metric-list">
            <div>
              <dt>Position</dt>
              <dd>
                {formatNumber(world.vehicle.x_m)} / {formatNumber(world.vehicle.y_m)} m
              </dd>
            </div>
            <div>
              <dt>Heading</dt>
              <dd>{formatNumber(world.vehicle.heading_deg, 0)}°</dd>
            </div>
            <div>
              <dt>Nearest range</dt>
              <dd>{nearestRange === null ? "--" : `${formatNumber(nearestRange, 2)} m`}</dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>{Math.round(world.environment.visibility_score * 100)}%</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="telemetry-strip">
        <article>
          <span>Sensor health</span>
          <strong>
            {world.sensor_health.filter((sensor) => sensor.status === "HEALTHY").length}/
            {world.sensor_health.length || 6}
          </strong>
          <small>range sensors online</small>
        </article>
        <article>
          <span>Visibility state</span>
          <strong>{world.environment.visibility_state.replace("_", " ")}</strong>
          <small>camera-derived metric is simulated</small>
        </article>
        <article>
          <span>Emergency logic</span>
          <strong className={`emergency-${world.emergency.state.toLowerCase()}`}>
            {world.emergency.state.replace("_", " ")}
          </strong>
          <small>motor cut {world.emergency.motor_cut ? "active" : "inactive"}</small>
        </article>
        <article>
          <span>Environment</span>
          <strong>{formatNumber(world.environment.temperature_c)}°C</strong>
          <small>{formatNumber(world.environment.pressure_hpa)} hPa</small>
        </article>
      </section>

      <footer>
        V1 uses simulated telemetry. ToF reconstruction is 2D/2.5D awareness, not true
        LiDAR.
      </footer>
    </main>
  );
}

