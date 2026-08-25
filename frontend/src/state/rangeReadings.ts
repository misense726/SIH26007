import type { RangeReading, SensorHealth } from "../types";

export function isUsableRangeReading(reading: RangeReading): boolean {
  return (
    reading.is_valid &&
    Number.isFinite(reading.range_m) &&
    reading.range_m > 0 &&
    reading.quality >= 0.5
  );
}

export function usableRangeReadings(readings: RangeReading[]): RangeReading[] {
  return readings.filter(isUsableRangeReading);
}

export function availableRangeReadings(
  readings: RangeReading[],
  sensorHealth: SensorHealth[],
  telemetryConnected: boolean,
): RangeReading[] {
  if (!telemetryConnected) {
    return [];
  }

  const availableSensors = new Set(
    sensorHealth
      .filter((sensor) => sensor.status === "HEALTHY" || sensor.status === "DEGRADED")
      .map((sensor) => sensor.sensor_id),
  );
  return usableRangeReadings(readings).filter((reading) =>
    availableSensors.has(reading.sensor_id),
  );
}
