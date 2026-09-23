import { STATIC_DEMO } from "../simulation/demoMode";
import type {
  FleetVehicleSummary,
  GuidanceResponse,
  HaulageMetrics,
  MineEdge,
  MineNetwork,
  RoadStatus,
  TripHistoryResponse,
} from "../types";

export async function fetchMineNetwork(): Promise<MineNetwork> {
  const res = await fetch("/api/mine/network");
  if (!res.ok) {
    throw new Error(`Failed to fetch mine network: ${res.statusText}`);
  }
  return res.json();
}

export async function updateMineEdgeStatus(
  edgeId: string,
  status: RoadStatus,
  riskPenalty?: number,
  speedLimitKmh?: number,
  reason?: string,
): Promise<MineEdge> {
  const res = await fetch(`/api/mine/edges/${encodeURIComponent(edgeId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      risk_penalty: riskPenalty,
      speed_limit_kmh: speedLimitKmh,
      reason: reason ?? "Manual dispatcher override",
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update edge status: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchNavigationGuidance(
  vehicleId: string = "DUMPER_01",
): Promise<GuidanceResponse> {
  const res = await fetch(`/api/navigation/guidance?vehicle_id=${encodeURIComponent(vehicleId)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch guidance: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchFleetVehicles(): Promise<FleetVehicleSummary[]> {
  const res = await fetch("/api/fleet/vehicles");
  if (!res.ok) {
    throw new Error(`Failed to fetch fleet vehicles: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchHaulageMetrics(): Promise<HaulageMetrics> {
  const res = await fetch(STATIC_DEMO ? "/demo/haulage-metrics.json" : "/api/analytics/haulage-metrics");
  if (!res.ok) {
    throw new Error(`Failed to fetch haulage metrics: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchTripHistory(
  limit: number = 50,
  vehicleId?: string,
  signal?: AbortSignal,
): Promise<TripHistoryResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (vehicleId) query.set("vehicle_id", vehicleId);
  const url = STATIC_DEMO ? "/demo/trip-history.json" : `/api/analytics/trip-history?${query}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch trip history: ${res.statusText}`);
  }
  const history: TripHistoryResponse = await res.json();
  if (!STATIC_DEMO) return history;
  const trips = history.trips.filter((trip) => !vehicleId || trip.vehicle_id === vehicleId);
  return {
    trips: [...trips].sort((a, b) => b.end_time_ms - a.end_time_ms).slice(0, limit),
    total_trips: trips.length,
    total_tonnes: trips.reduce((sum, trip) => sum + trip.payload_tonnes, 0),
  };
}
