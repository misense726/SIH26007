import { defaultWorldState } from "./defaultState";
import { usableRangeReadings } from "./rangeReadings";
import type { RangeReading, SensorHealth, VehiclePose, WorldState } from "../types";

export const EXPECTED_TOF_SENSOR_COUNT = 5;
export const TOF_SENSOR_IDS = [
  "front_scanner",
  "front_fixed",
  "rear_scanner",
  "left_side",
  "right_side",
] as const;

const TOF_SENSOR_ID_SET = new Set<string>(TOF_SENSOR_IDS);

export function primaryVehicleOrNull(world: WorldState): VehiclePose | null {
  return world.vehicles.find(
    (vehicle) => vehicle.vehicle_id === world.primary_vehicle_id,
  ) ?? null;
}

export function primaryVehicle(world: WorldState): VehiclePose {
  return primaryVehicleOrNull(world) ?? defaultWorldState.vehicles[0];
}

export function nearestRange(readings: RangeReading[]): number | null {
  const trusted = usableRangeReadings(readings);
  return trusted.length > 0 ? Math.min(...trusted.map((reading) => reading.range_m)) : null;
}

export function healthySensorCount(world: WorldState): number {
  return world.sensor_health.filter((sensor) => sensor.status === "HEALTHY").length;
}

export function tofSensorHealth(sensors: SensorHealth[]): SensorHealth[] {
  const healthById = new Map(
    sensors
      .filter((sensor) => TOF_SENSOR_ID_SET.has(sensor.sensor_id))
      .map((sensor) => [sensor.sensor_id, sensor]),
  );

  return TOF_SENSOR_IDS.map(
    (sensorId): SensorHealth =>
      healthById.get(sensorId) ?? {
        sensor_id: sensorId,
        status: "OFFLINE",
        last_update_ms: 0,
        confidence: 0,
        detail: "No status received",
      },
  );
}

export function tofSensorHealthSummary(sensors: SensorHealth[]): {
  healthy: number;
  total: number;
} {
  const tofSensors = tofSensorHealth(sensors);

  return {
    healthy: tofSensors.filter((sensor) => sensor.status === "HEALTHY").length,
    total: EXPECTED_TOF_SENSOR_COUNT,
  };
}

export function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}
