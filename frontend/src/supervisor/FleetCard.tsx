import { formatNumber, tofSensorHealthSummary } from "../state/selectors";
import type { EmergencyState, EnvironmentState, SensorHealth } from "../types";

export interface FleetTruckData {
  vehicle_id: string;
  is_primary: boolean;
  x_m: number;
  y_m: number;
  heading_deg: number;
  speed_mps: number;
  emergency_state: string;
  distance_m?: number;
  link_status?: string;
  rssi_dbm?: number;
}

interface FleetCardProps {
  truck: FleetTruckData;
  environment?: EnvironmentState;
  emergency?: EmergencyState;
  sensors?: SensorHealth[];
  isSelected?: boolean;
  onSelect?: () => void;
}

export function FleetCard({
  truck,
  environment,
  emergency,
  sensors,
  isSelected,
  onSelect,
}: FleetCardProps) {
  const sensorSummary = sensors ? tofSensorHealthSummary(sensors) : null;
  const emergencyClass = (truck.emergency_state || "SAFE").toLowerCase().replace("_", "-");

  return (
    <article
      className={`fleet-card ${isSelected ? "fleet-card-selected" : ""} ${truck.is_primary ? "fleet-card-primary" : "fleet-card-peer"}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      title="Click to locate on fleet map"
    >
      <header>
        <div>
          <span className="driver-role-tag">{truck.is_primary ? "LEAD TRUCK" : "V2V HAULER"}</span>
          <h3 className="truck-title">
            <span className="truck-icon">🚛</span> {truck.vehicle_id}
          </h3>
        </div>
        <span className={`fleet-state fleet-state-${emergencyClass}`}>
          {truck.emergency_state.replaceAll("_", " ")}
        </span>
      </header>

      <div className="fleet-speed">
        <strong>{formatNumber(truck.speed_mps * 3.6, 1)}</strong>
        <span>km/h</span>
      </div>

      <dl className="fleet-details">
        <div>
          <dt>Coordinates</dt>
          <dd>
            X:{formatNumber(truck.x_m, 1)} Y:{formatNumber(truck.y_m, 1)} m
          </dd>
        </div>
        <div>
          <dt>Heading</dt>
          <dd>{formatNumber(truck.heading_deg, 0)}°</dd>
        </div>
        {truck.distance_m !== undefined && !truck.is_primary && (
          <div>
            <dt>Dist to Lead</dt>
            <dd>{formatNumber(truck.distance_m, 1)} m</dd>
          </div>
        )}
        {truck.link_status && !truck.is_primary && (
          <div>
            <dt>V2X Link</dt>
            <dd>
              <span className={`link-badge link-${truck.link_status.toLowerCase()}`}>
                {truck.link_status} {truck.rssi_dbm ? `(${truck.rssi_dbm} dBm)` : ""}
              </span>
            </dd>
          </div>
        )}
        {truck.is_primary && environment && (
          <div>
            <dt>Visibility</dt>
            <dd>{Math.round(environment.visibility_score * 100)}%</dd>
          </div>
        )}
        {truck.is_primary && sensorSummary && (
          <div>
            <dt>ToF Health</dt>
            <dd>
              {sensorSummary.healthy}/{sensorSummary.total} healthy
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}
