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
  const res = await fetch("/api/analytics/haulage-metrics");
  if (!res.ok) {
    throw new Error(`Failed to fetch haulage metrics: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchTripHistory(limit: number = 50): Promise<TripHistoryResponse> {
  const res = await fetch(`/api/analytics/trip-history?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch trip history: ${res.statusText}`);
  }
  return res.json();
}
