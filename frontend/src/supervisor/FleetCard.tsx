import { formatNumber, tofSensorHealthSummary } from "../state/selectors";
import type { EnvironmentState, EmergencyState, SensorHealth, VehiclePose } from "../types";

interface FleetCardProps {
  vehicle: VehiclePose;
  environment: EnvironmentState;
  emergency: EmergencyState;
  sensors: SensorHealth[];
}

export function FleetCard({ vehicle, environment, emergency, sensors }: FleetCardProps) {
  const sensorSummary = tofSensorHealthSummary(sensors);
  const emergencyClass = emergency.state.toLowerCase().replace("_", "-");

  return (
    <article className="fleet-card">
      <header>
        <div>
          <p className="eyebrow">Active dumper</p>
          <h3>{vehicle.vehicle_id}</h3>
        </div>
        <span className={`fleet-state fleet-state-${emergencyClass}`}>
          {emergency.state.replaceAll("_", " ")}
        </span>
      </header>
      <div className="fleet-speed">
        <strong>{formatNumber(vehicle.speed_mps * 3.6, 1)}</strong>
        <span>km/h</span>
      </div>
      <dl className="fleet-details">
        <div><dt>X / Y</dt><dd>{formatNumber(vehicle.x_m)} / {formatNumber(vehicle.y_m)} m</dd></div>
        <div><dt>Heading</dt><dd>{formatNumber(vehicle.heading_deg, 0)}°</dd></div>
        <div><dt>Relative altitude</dt><dd>{formatNumber(environment.relative_altitude_m, 2)} m approx.</dd></div>
        <div><dt>Visibility</dt><dd>{Math.round(environment.visibility_score * 100)}%</dd></div>
        <div><dt>ToF health</dt><dd>{sensorSummary.healthy}/{sensorSummary.total} healthy</dd></div>
      </dl>
    </article>
  );
}
