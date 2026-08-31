import type { SensorHealth } from "../types";

function displayName(sensorId: string): string {
  return sensorId
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function SensorHealthList({ sensors }: { sensors: SensorHealth[] }) {
  return (
    <div className="sensor-health-list">
      {sensors.length === 0 ? (
        <p className="empty-state">Sensor status unavailable.</p>
      ) : (
        sensors.map((sensor) => (
          <div key={sensor.sensor_id} className="sensor-health-row">
            <span className={`health-dot health-${sensor.status.toLowerCase()}`} aria-hidden="true" />
            <span>{displayName(sensor.sensor_id)}</span>
            <strong>{sensor.status}</strong>
            <small>{Math.round(sensor.confidence * 100)}%</small>
          </div>
        ))
      )}
    </div>
  );
}
