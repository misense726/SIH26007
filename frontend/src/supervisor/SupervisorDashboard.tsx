import { useState } from "react";
import { SensorHealthList } from "../components/SensorHealthList";
import { availableRangeReadings } from "../state/rangeReadings";
import {
  formatNumber,
  nearestRange,
  primaryVehicleOrNull,
  tofSensorHealth,
  tofSensorHealthSummary,
} from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import { TwinMap } from "../twin/TwinMap";
import type { WorldState } from "../types";
import { FleetCard, type FleetTruckData } from "./FleetCard";
import { V2XPanel } from "./V2XPanel";

interface SupervisorDashboardProps {
  world: WorldState;
  connection: ConnectionState;
}

export function SupervisorDashboard({ world, connection }: SupervisorDashboardProps) {
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);

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
            <span><strong>--</strong> trucks</span>
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
        </article>
      </section>
    );
  }

  const nearest = nearestRange(
    availableRangeReadings(world.ranges, world.sensor_health, true),
  );
  const tofSensors = tofSensorHealth(world.sensor_health);
  const sensorSummary = tofSensorHealthSummary(world.sensor_health);

  const primaryVehicle = primaryVehicleOrNull(world);
  const activePeers = world.v2x?.active_peers ?? [];

  // Build unified fleet trucks list
  const allTrucks: FleetTruckData[] = [
    ...(primaryVehicle ? [{
      vehicle_id: primaryVehicle.vehicle_id,
      is_primary: true,
      is_simulated: false,
      x_m: primaryVehicle.x_m,
      y_m: primaryVehicle.y_m,
      heading_deg: primaryVehicle.heading_deg,
      speed_mps: primaryVehicle.speed_mps,
      emergency_state: world.emergency.state,
    }] : []),
    ...activePeers.map((peer) => ({
      vehicle_id: peer.vehicle_id,
      is_primary: false,
      is_simulated: true,
      x_m: peer.x_m,
      y_m: peer.y_m,
      heading_deg: peer.heading_deg,
      speed_mps: peer.speed_mps,
      emergency_state: peer.emergency_state,
      distance_m: peer.distance_m,
      link_status: peer.link_status,
    })),
  ];
  const canonicalAlerts = [...world.alerts].sort((a, b) => b.timestamp_ms - a.timestamp_ms);
  const hasMatchingCanonicalAlert = (vehicleId: string, emergencyState: string) =>
    canonicalAlerts.some(
      (alert) =>
        alert.vehicle_id === vehicleId &&
        alert.title.toUpperCase().replaceAll("_", " ").includes(
          emergencyState.toUpperCase().replaceAll("_", " "),
        ),
    );
  const currentSafetyAlerts = [
    ...(primaryVehicle && world.emergency.state !== "SAFE" && !hasMatchingCanonicalAlert(primaryVehicle.vehicle_id, world.emergency.state)
      ? [{
          event_id: `current-${primaryVehicle.vehicle_id}`,
          title: world.emergency.state.replaceAll("_", " "),
          detail: world.emergency.reason ?? "Unsafe vehicle condition detected.",
          vehicle_id: primaryVehicle.vehicle_id,
        }]
      : []),
    ...activePeers
      .filter(
        (peer) =>
          peer.emergency_state !== "SAFE" &&
          !hasMatchingCanonicalAlert(peer.vehicle_id, peer.emergency_state),
      )
      .map((peer) => ({
        event_id: `current-${peer.vehicle_id}`,
        title: peer.emergency_state.replaceAll("_", " "),
        detail: `${peer.vehicle_id} reports an unsafe state in the V2X simulation.`,
        vehicle_id: peer.vehicle_id,
      })),
  ];
  const safetyAlerts = [...currentSafetyAlerts, ...canonicalAlerts];

  return (
    <section className="dashboard supervisor-dashboard" aria-label="Supervisor dashboard">
      <div className="supervisor-summary">
        <div>
          <p className="eyebrow">Fleet operations</p>
          <h2>{world.reference_map?.name ?? "Reference map unavailable"}</h2>
        </div>
        <div className="summary-metrics">
          <span><strong>{allTrucks.length}</strong> vehicles tracked</span>
          <span><strong>{safetyAlerts.length}</strong> alerts</span>
          <span><strong>{Math.round(world.environment.visibility_score * 100)}%</strong> visibility</span>
        </div>
      </div>

      <div className="supervisor-grid">
        <article className="fleet-map-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live fleet map</p>
              <h2>Vehicle positions</h2>
            </div>
            <span className="source-badge">
              {allTrucks.length} tracked
            </span>
          </div>
          <TwinMap
            world={world}
            selectedTruckId={selectedTruckId}
            onSelectTruck={setSelectedTruckId}
          />
        </article>

        <aside className="fleet-column">
          <div className="fleet-column-header">
            <h3>Vehicles ({allTrucks.length})</h3>
          </div>
          {allTrucks.map((truck) => (
            <FleetCard
              key={truck.vehicle_id}
              truck={truck}
              environment={truck.is_primary ? world.environment : undefined}
              emergency={truck.is_primary ? world.emergency : undefined}
              sensors={truck.is_primary ? world.sensor_health : undefined}
              isSelected={selectedTruckId === truck.vehicle_id}
              onSelect={() =>
                setSelectedTruckId(
                  selectedTruckId === truck.vehicle_id ? null : truck.vehicle_id,
                )
              }
            />
          ))}
          {allTrucks.length === 0 && (
            <p className="empty-state">No vehicle telemetry.</p>
          )}
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
            <div><span>Visibility</span><strong>{world.environment.visibility_state.replace("_", " ")}</strong></div>
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
              <h2>Recent alerts</h2>
            </div>
            <span className={`alert-count ${safetyAlerts.length > 0 ? "alert-count-active" : ""}`}>
              {safetyAlerts.length}
            </span>
          </div>
          {safetyAlerts.length === 0 ? (
            <div className="alerts-empty">
              <span className="alerts-check">✓</span>
              <strong>No safety alerts</strong>
            </div>
          ) : (
            safetyAlerts.map((alert) => (
              <div className="active-alert" role="alert" key={alert.event_id}>
                <strong>{alert.vehicle_id}: {alert.title}</strong>
                <span>{alert.detail}</span>
              </div>
            ))
          )}
        </article>
      </div>

      <V2XPanel v2x={world.v2x} />
    </section>
  );
}
