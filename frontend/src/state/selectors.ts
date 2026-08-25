import { defaultWorldState } from "./defaultState";
import { usableRangeReadings } from "./rangeReadings";
import type { RangeReading, VehiclePose, WorldState } from "../types";

export function primaryVehicle(world: WorldState): VehiclePose {
  return (
    world.vehicles.find((vehicle) => vehicle.vehicle_id === world.primary_vehicle_id) ??
    world.vehicles[0] ??
    defaultWorldState.vehicles[0]
  );
}

export function nearestRange(readings: RangeReading[]): number | null {
  const trusted = usableRangeReadings(readings);
  return trusted.length > 0 ? Math.min(...trusted.map((reading) => reading.range_m)) : null;
}

export function healthySensorCount(world: WorldState): number {
  return world.sensor_health.filter((sensor) => sensor.status === "HEALTHY").length;
}

export function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}
