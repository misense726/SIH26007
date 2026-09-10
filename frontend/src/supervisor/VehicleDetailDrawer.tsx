import type { EmergencyState, EnvironmentState, FleetVehicleSummary, SensorHealth } from "../types";
import { formatNumber } from "../state/selectors";

interface VehicleDetailDrawerProps {
  truckId: string | null;
  summary?: FleetVehicleSummary | null;
  environment?: EnvironmentState;
  emergency?: EmergencyState;
  sensors?: SensorHealth[];
  onClose: () => void;
}

export function VehicleDetailDrawer({
  truckId,
  summary,
  environment,
  emergency,
  sensors,
  onClose,
}: VehicleDetailDrawerProps) {
  if (!truckId) return null;

  if (!summary) {
    return (
      <aside className="vehicle-detail-drawer" aria-label={`Vehicle telemetry detail for ${truckId}`}>
        <div className="drawer-header">
          <div>
            <div className="drawer-eyebrow-row">
              <span className="drawer-eyebrow">Haul Fleet Telemetry</span>
              <span className="payload-status-badge badge-grey">UNVERIFIED</span>
            </div>
            <h3 className="drawer-title">{truckId}</h3>
          </div>
          <button
            type="button"
            className="drawer-close-btn"
            onClick={onClose}
            aria-label="Close vehicle details"
          >
            ✕
          </button>
        </div>
        <div className="drawer-content">
          <div className="drawer-state-card state-unverified">
            <span className="state-label">Operational Status</span>
            <strong className="state-value">UNVERIFIED</strong>
            <span className="state-sub">Vehicle telemetry metadata unavailable</span>
          </div>
        </div>
      </aside>
    );
  }

  const vehicleId = summary.vehicle_id;
  const callsign = summary.callsign;
  const cycleState = summary.cycle_state;
  const payload = summary.payload_tonnes;
  const tareWeight = summary.tare_weight_tonnes;
  const totalWeight = summary.total_weight_tonnes;
  const speedKmh = summary.speed_kmh;
  const headingDeg = summary.heading_deg;
  const dest = summary.current_destination;
  const distRem = summary.distance_to_destination_m;
  const nextInstr = summary.next_instruction;
  const tripsCompleted = summary.total_trips_completed;
  const tonnesMoved = summary.total_tonnes_moved;
  const currentEdge = summary.current_edge_id;

  const isLoaded = payload > 10;
  const isEmergency = summary.emergency_state && summary.emergency_state !== "SAFE";

  return (
    <aside className="vehicle-detail-drawer" aria-label={`Vehicle telemetry detail for ${callsign}`}>
      <div className="drawer-header">
        <div>
          <div className="drawer-eyebrow-row">
            <span className="drawer-eyebrow">Haul Fleet Telemetry</span>
            <span className={`payload-status-badge ${isLoaded ? "badge-loaded" : "badge-empty"}`}>
              {isLoaded ? `LOADED ${payload.toFixed(0)}T` : "EMPTY 0T"}
            </span>
          </div>
          <h3 className="drawer-title">{callsign}</h3>
          <span className="drawer-callsign-sub">{vehicleId}</span>
        </div>
        <button
          type="button"
          className="drawer-close-btn"
          onClick={onClose}
          aria-label="Close vehicle details"
        >
          ✕
        </button>
      </div>

      <div className="drawer-content">
        {/* Cycle State Badge */}
        <div className={`drawer-state-card ${isEmergency ? "state-emergency" : ""}`}>
          <span className="state-label">Cycle State</span>
          <strong className="state-value">{cycleState.replaceAll("_", " ")}</strong>
          <span className="state-sub">Operational Haulage Phase</span>
        </div>

        {/* Dynamics: Speed, Heading, Elevation */}
        <div className="drawer-metric-row">
          <div className="drawer-metric-box">
            <span>Speed</span>
            <strong>{formatNumber(speedKmh, 1)}</strong>
            <small>km/h</small>
          </div>
          <div className="drawer-metric-box">
            <span>Heading</span>
            <strong>{formatNumber(headingDeg, 0)}°</strong>
            <small>bearing</small>
          </div>
          <div className="drawer-metric-box">
            <span>Elevation</span>
            <strong>{formatNumber(summary.elevation_m, 1)}</strong>
            <small>RL (m)</small>
          </div>
        </div>

        {/* Payload & Mass Weight Distribution */}
        <div className="drawer-card mass-card">
          <div className="card-header-simple">
            <span>Payload & Mass Distribution</span>
            <strong>{totalWeight.toFixed(0)} T Total Mass</strong>
          </div>
          <div className="payload-bar-track" aria-hidden="true">
            <div
              className={`payload-bar-fill ${isLoaded ? "fill-loaded" : "fill-empty"}`}
              style={{ width: `${Math.min(100, (payload / 120) * 100)}%` }}
            />
          </div>
          <div className="mass-meta-row">
            <div>
              <span>Tare Truck</span>
              <strong>{tareWeight.toFixed(0)} T</strong>
            </div>
            <div>
              <span>Iron Ore Payload</span>
              <strong className={isLoaded ? "text-amber" : ""}>{payload.toFixed(0)} T</strong>
            </div>
            <div>
              <span>Gross Weight</span>
              <strong>{totalWeight.toFixed(0)} T</strong>
            </div>
          </div>
        </div>

        {/* Navigation & Active Route */}
        <div className="drawer-card route-card">
          <span className="card-eyebrow">Active Navigation</span>
          <div className="route-dest-row">
            <div>
              <span>Destination</span>
              <h4>{dest}</h4>
            </div>
            <div className="dist-badge">
              <strong>{distRem.toFixed(0)} m</strong>
              <small>remaining</small>
            </div>
          </div>
          {currentEdge && (
            <div className="current-edge-badge">
              <span>Current Edge:</span> <strong>{currentEdge}</strong>
            </div>
          )}
          <div className="drawer-instruction-box">
            <span className="instruction-arrow">➔</span>
            <p>{nextInstr}</p>
          </div>
        </div>

        {/* Shift Production Metrics */}
        <div className="drawer-card production-card">
          <span className="card-eyebrow">Shift Production Output</span>
          <div className="prod-stats-row">
            <div>
              <span>Completed Trips</span>
              <strong>{tripsCompleted} cycles</strong>
            </div>
            <div>
              <span>Total Ore Moved</span>
              <strong>{tonnesMoved.toFixed(0)} Tonnes</strong>
            </div>
          </div>
        </div>

        {/* Environmental Telemetry if Primary */}
        {environment && (
          <div className="drawer-card env-card">
            <span className="card-eyebrow">Onboard Telemetry (BMP280)</span>
            <div className="env-meta-grid">
              <div><span>Ambient Temp</span><strong>{formatNumber(environment.temperature_c, 1)}°C</strong></div>
              <div><span>Barometer</span><strong>{formatNumber(environment.pressure_hpa, 1)} hPa</strong></div>
              <div><span>Rel Altitude</span><strong>{formatNumber(environment.relative_altitude_m, 2)} m</strong></div>
              <div><span>Visibility Score</span><strong>{Math.round(environment.visibility_score * 100)}%</strong></div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
