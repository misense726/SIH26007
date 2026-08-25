import type { SensorHealth, SpatialPoint, VehiclePose } from "../types";

const MAX_POINT_AGE_MS = 12_000;
const MAX_RENDERED_POINTS = 240;

export function isUsableSpatialPoint(
  point: SpatialPoint,
  generatedAtMs: number,
): boolean {
  const ageMs = generatedAtMs - point.timestamp_ms;
  return (
    Number.isFinite(point.x_m) &&
    Number.isFinite(point.y_m) &&
    point.quality >= 0.5 &&
    ageMs >= 0 &&
    ageMs <= MAX_POINT_AGE_MS
  );
}

export function availableSpatialPoints(
  points: SpatialPoint[],
  sensorHealth: SensorHealth[],
  telemetryConnected: boolean,
  generatedAtMs: number,
  vehicle: VehiclePose,
  displayRadiusM = 4,
): SpatialPoint[] {
  if (!telemetryConnected) {
    return [];
  }

  const availableSensors = new Set(
    sensorHealth
      .filter((sensor) => sensor.status === "HEALTHY" || sensor.status === "DEGRADED")
      .map((sensor) => sensor.sensor_id),
  );

  return points
    .filter(
      (point) =>
        availableSensors.has(point.source_sensor_id) &&
        isUsableSpatialPoint(point, generatedAtMs) &&
        Math.hypot(point.x_m - vehicle.x_m, point.y_m - vehicle.y_m) <= displayRadiusM,
    )
    .slice(-MAX_RENDERED_POINTS);
}
