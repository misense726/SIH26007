import type { SensorHealth } from "../types";

function displayName(sensorId: string): string {
  return sensorId
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function formatAge(referenceTimestampMs: number | undefined, lastUpdateMs: number): string {
  if (!referenceTimestampMs || !lastUpdateMs) return "No update";
  const ageMs = Math.max(0, referenceTimestampMs - lastUpdateMs);
  if (ageMs < 1_000) return "Now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s`;
  return `${Math.round(ageMs / 60_000)}m`;
}

export function SensorHealthList({
  sensors,
  referenceTimestampMs,
}: {
  sensors: SensorHealth[];
  referenceTimestampMs?: number;
}) {
  return (
    <div className="sensor-health-list" role="list" aria-label="Range sensor health">
      {sensors.length === 0 ? (
        <p className="empty-state">Sensor status unavailable.</p>
      ) : (
        sensors.map((sensor) => (
          <div
            key={sensor.sensor_id}
            className={`sensor-health-row sensor-health-${sensor.status.toLowerCase()}`}
            role="listitem"
            title={sensor.detail ?? undefined}
          >
            <span className={`health-dot health-${sensor.status.toLowerCase()}`} aria-hidden="true" />
            <span className="sensor-health-name">
              <strong>{displayName(sensor.sensor_id)}</strong>
              <small>{sensor.detail ?? "Reporting normally"}</small>
            </span>
            <span className="sensor-health-state">{sensor.status.toLowerCase()}</span>
            <span className="sensor-health-confidence">{Math.round(sensor.confidence * 100)}%</span>
            <span className="sensor-health-age">{formatAge(referenceTimestampMs, sensor.last_update_ms)}</span>
          </div>
        ))
      )}
    </div>
  );
}
