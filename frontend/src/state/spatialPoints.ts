import type { SensorHealth, SpatialPoint, VehiclePose } from "../types";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";

const MAX_POINT_AGE_MS = 12_000;
const MAX_RENDERED_POINTS = 240;
const DISPLAY_CELL_M = 0.04;

export function spatialPointCellKey(point: SpatialPoint): string {
  return `${point.source_sensor_id}:${Math.round(point.x_m / DISPLAY_CELL_M)}:${Math.round(point.y_m / DISPLAY_CELL_M)}`;
}

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
  sensors?: SensorDisplaySetting[],
): SpatialPoint[] {
  if (!telemetryConnected) {
    return [];
  }

  const availableSensors = new Set(
    sensorHealth
      .filter((sensor) => sensor.status === "HEALTHY" || sensor.status === "DEGRADED")
      .map((sensor) => sensor.sensor_id),
  );
  const settingsById = sensors
    ? new Map<string, SensorDisplaySetting>(sensors.map((sensor) => [sensor.sensor_id, sensor]))
    : null;
  const heading = vehicle.heading_deg * Math.PI / 180;
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);

  const withinRange = (point: SpatialPoint): boolean => {
    const dx = point.x_m - vehicle.x_m;
    const dy = point.y_m - vehicle.y_m;
    if (!settingsById) return Math.hypot(dx, dy) <= displayRadiusM;
    const sensor = settingsById.get(point.source_sensor_id);
    if (!sensor) return false;
    // Backend points are planar measurements. Their display height is not range.
    return Math.hypot(
      dx * cosine - dy * sine - sensor.display_pose.x_m,
      dx * sine + dy * cosine - sensor.display_pose.y_m,
    ) <= sensor.visual_range_m;
  };

  const usable = points.filter(
      (point) =>
        availableSensors.has(point.source_sensor_id) &&
        isUsableSpatialPoint(point, generatedAtMs) &&
        withinRange(point),
    );
  // Deduplicate before the display budget. Repeated fixed-sensor samples must
  // not evict an entire scanner sweep. Cells stay anchored in world metres.
  const cells = new Map<string, SpatialPoint>();
  for (const point of usable) {
    const key = spatialPointCellKey(point);
    const previous = cells.get(key);
    if (!previous || point.timestamp_ms >= previous.timestamp_ms) cells.set(key, point);
  }
  const bySensor = new Map<string, SpatialPoint[]>();
  for (const point of [...cells.values()].sort((a, b) => b.timestamp_ms - a.timestamp_ms)) {
    const bucket = bySensor.get(point.source_sensor_id) ?? [];
    bucket.push(point);
    bySensor.set(point.source_sensor_id, bucket);
  }
  const selected: SpatialPoint[] = [];
  for (let index = 0; selected.length < MAX_RENDERED_POINTS; index++) {
    let found = false;
    for (const bucket of bySensor.values()) {
      if (bucket[index] && selected.length < MAX_RENDERED_POINTS) {
        selected.push(bucket[index]);
        found = true;
      }
    }
    if (!found) break;
  }
  return selected.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
}
