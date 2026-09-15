import type { DataMode, TripRecord as ApiTripRecord } from "../types";

export const DISPLAYED_TRIP_COUNT = 15;
export const EFFICIENCY_REFRESH_MS = 30_000;

export interface EfficiencyTrip {
  id: string;
  number: number;
  payloadT: number;
  fuelL: number;
  distanceKm: number;
  efficiency: number;
  durationMin: number;
  idleMin: number;
  avgSpeedKmh: number;
  endedAtMs: number;
  source?: DataMode;
}

export function toEfficiencyTrip(trip: ApiTripRecord, number: number): EfficiencyTrip | null {
  const values = [trip.payload_tonnes, trip.fuel_litres_est, trip.distance_km];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  if (!Number.isFinite(trip.end_time_ms) || !Number.isFinite(new Date(trip.end_time_ms).getTime())) return null;
  if (!Number.isFinite(trip.cycle_duration_s) || trip.cycle_duration_s < 0) return null;
  const efficiency = trip.payload_tonnes * trip.distance_km / trip.fuel_litres_est;
  if (!Number.isFinite(efficiency)) return null;
  return {
    id: trip.trip_id,
    number,
    payloadT: trip.payload_tonnes,
    fuelL: trip.fuel_litres_est,
    distanceKm: trip.distance_km,
    efficiency,
    durationMin: trip.cycle_duration_s / 60,
    idleMin: Math.max(0, Number.isFinite(trip.idle_s) ? trip.idle_s / 60 : 0),
    avgSpeedKmh: Math.max(0, Number.isFinite(trip.avg_speed_kmh) ? trip.avg_speed_kmh : 0),
    endedAtMs: trip.end_time_ms,
    source: trip.source ?? undefined,
  };
}

export function selectEfficiencyTrips(records: ApiTripRecord[], vehicleId: string, limit: number): EfficiencyTrip[] {
  const seen = new Set<string>();
  const valid = records
    .filter((trip) => trip.vehicle_id === vehicleId)
    .sort((a, b) => a.end_time_ms - b.end_time_ms || a.trip_id.localeCompare(b.trip_id))
    .flatMap((record) => {
      if (seen.has(record.trip_id)) return [];
      seen.add(record.trip_id);
      const trip = toEfficiencyTrip(record, 0);
      return trip ? [trip] : [];
    });
  return valid.slice(-limit).map((trip, index) => ({ ...trip, number: index + 1 }));
}

export function summarizeTrips(trips: EfficiencyTrip[]) {
  const totalPayload = trips.reduce((sum, trip) => sum + trip.payloadT, 0);
  const totalFuel = trips.reduce((sum, trip) => sum + trip.fuelL, 0);
  const transportWork = trips.reduce((sum, trip) => sum + trip.payloadT * trip.distanceKm, 0);
  return {
    count: trips.length,
    totalPayload,
    totalFuel,
    efficiency: totalFuel > 0 ? transportWork / totalFuel : null,
    fuelPerTonne: totalPayload > 0 ? totalFuel / totalPayload : null,
    averagePayload: trips.length ? totalPayload / trips.length : null,
    minPayload: trips.length ? Math.min(...trips.map((trip) => trip.payloadT)) : null,
    maxPayload: trips.length ? Math.max(...trips.map((trip) => trip.payloadT)) : null,
    best: trips.reduce<EfficiencyTrip | null>((best, trip) => !best || trip.efficiency > best.efficiency ? trip : best, null),
  };
}

export function efficiencyScale(values: number[]) {
  const finite = values.filter((n) => Number.isFinite(n));
  if (!finite.length) {
    return { min: 0, max: 20, ticks: [0, 5, 10, 15, 20] };
  }
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const padding = Math.max((high - low) * 0.18, 0.5);
  const roughStep = (high - low + padding * 2) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep || 1));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).find((n) => n >= roughStep) ?? magnitude * 10;
  const min = Math.max(0, Math.floor((low - padding) / step) * step);
  const max = Math.ceil((high + padding) / step) * step;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
  return { min, max, ticks };
}

export function formatValue(value: number | null | undefined, digits = 1): string {
  return value != null && Number.isFinite(value) ? value.toFixed(digits) : "—";
}
