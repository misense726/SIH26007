import type { VehiclePose, WorldState } from "../types";
import { localPoint } from "./routeGeometry";

export interface ForwardHazard {
  id: string;
  kind: "TRUCK" | "ROCK";
  distance_m: number;
  title: string;
  detail: string;
  lastSeenMs: number;
}

const ENCOUNTER_HOLD_MS = 8000;

/** Simulated scene alerts use backend-owned poses, not scanning-beam flicker. */
export function selectSimulatedForwardHazard(
  world: WorldState,
  vehicle: VehiclePose,
  previous: ForwardHazard | null = null,
): ForwardHazard | null {
  if (world.mode !== "SIMULATED" || vehicle.position_confidence < 0.5) return null;
  const enterDistance = Math.max(7.5, Math.min(12, vehicle.speed_mps * 4 + 2));
  const candidates: ForwardHazard[] = [];
  const eligible = (id: string, x: number, y: number, halfWidth: number) =>
    y > 1.6 && y <= enterDistance + (previous?.id === id ? 2 : 0) &&
    Math.abs(x) <= halfWidth + (previous?.id === id ? 0.35 : 0);

  const rock = world.haul_route?.obstacle;
  if (rock && world.haul_route?.obstacle_detected) {
    const local = localPoint(rock, vehicle);
    // The haul road bends into the rock. Include its approach around the bend,
    // then let the alert clear once the truck has steered past it.
    if (eligible("rock", local.x_m, local.y_m, 2.7)) {
      const distance = Math.max(0, local.y_m - 1.6 - world.haul_route!.obstacle_radius_m);
      candidates.push({ id: "rock", kind: "ROCK", distance_m: distance,
        title: "Rock ahead", detail: `Rock ${distance.toFixed(1)} m ahead. Keep clear.`,
        lastSeenMs: world.generated_at_ms });
    }
  }

  for (const peer of world.vehicles) {
    if (peer.vehicle_id === vehicle.vehicle_id || peer.mode !== world.mode || peer.position_confidence < 0.5) continue;
    const local = localPoint(peer, vehicle);
    const id = `truck:${peer.vehicle_id}`;
    if (!eligible(id, local.x_m, local.y_m, 1.45)) continue;
    const distance = Math.max(0, local.y_m - 3.2);
    candidates.push({ id, kind: "TRUCK", distance_m: distance,
      title: "Truck ahead", detail: `${peer.vehicle_id} is ${distance.toFixed(1)} m ahead. Keep clear.`,
      lastSeenMs: world.generated_at_ms });
  }
  const current = candidates.sort((a, b) => a.distance_m - b.distance_m)[0];
  if (current) return current;
  if (previous && world.generated_at_ms >= previous.lastSeenMs &&
    world.generated_at_ms - previous.lastSeenMs < ENCOUNTER_HOLD_MS) {
    return { ...previous,
      title: previous.kind === "ROCK" ? "Rock encounter" : "Truck encounter",
      detail: previous.kind === "ROCK"
        ? "Rock nearby. Keep clear." : "Truck nearby. Keep clear." };
  }
  return null;
}
