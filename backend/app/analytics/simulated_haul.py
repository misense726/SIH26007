"""Deterministic demo loads and estimated fuel, never hardware measurements."""

from dataclasses import dataclass
from random import Random

from backend.app.fleet.models import TripRecord


SIMULATION_SEED = 26007
BASELINE_TRIPS_PER_VEHICLE = 15
PAYLOAD_CAPACITIES_TONNES = (100.0, 95.0, 105.0, 90.0, 100.0, 95.0, 105.0, 90.0)


@dataclass(frozen=True)
class HaulCyclePlan:
    payload_tonnes: float
    capacity_tonnes: float
    loading_scale: float
    dumping_scale: float
    speed_scale: float
    fuel_factor: float

    @property
    def payload_fraction(self) -> float:
        return self.payload_tonnes / self.capacity_tonnes


def cycle_plan(index: int, cycle: int, seed: int = SIMULATION_SEED) -> HaulCyclePlan:
    """Choose once per cycle. Consecutive loads differ and stay at 80-99% capacity."""
    rng = Random(f"{seed}:{index}:{cycle}")
    capacity = PAYLOAD_CAPACITIES_TONNES[index % len(PAYLOAD_CAPACITIES_TONNES)]
    fraction = 0.80 + ((cycle * 37 + index * 17 + seed) % 191) / 1000
    return HaulCyclePlan(
        payload_tonnes=round(capacity * fraction, 2),
        capacity_tonnes=capacity,
        loading_scale=rng.uniform(0.88, 1.18),
        dumping_scale=rng.uniform(0.88, 1.15),
        speed_scale=rng.uniform(0.88, 1.0),
        fuel_factor=rng.uniform(0.92, 1.10),
    )


def estimate_fuel_litres(
    *, payload_tonnes: float, loaded_distance_km: float, empty_distance_km: float,
    travel_s: float, loading_s: float, dumping_s: float, idle_s: float,
    fuel_factor: float = 1.0,
) -> float:
    """Illustrative diesel model: load/road resistance, speed, handling and idle.

    Loaded travel costs 3.5 L/km plus 0.035 L/km per tonne. Empty travel
    costs 3.0 L/km. Slow travel raises consumption per kilometre; hydraulic
    handling uses 12 L/h and stopped queuing 8 L/h. These are demo assumptions,
    not a calibrated fuel sensor or a manufacturer performance claim.
    """
    distance = loaded_distance_km + empty_distance_km
    speed_kmh = distance * 3600 / max(travel_s, 1.0)
    speed_penalty = 1 + max(0.0, 16 - speed_kmh) * 0.025 + max(0.0, speed_kmh - 28) * 0.015
    travel_fuel = (loaded_distance_km * (3.5 + payload_tonnes * 0.035)
                   + empty_distance_km * 3.0) * speed_penalty
    stationary_fuel = (loading_s + dumping_s) * 12 / 3600 + idle_s * 8 / 3600
    return round(max(0.01, (travel_fuel + stationary_fuel) * fuel_factor), 3)


def baseline_trips(end_time_ms: int, fleet_size: int = 8, seed: int = SIMULATION_SEED) -> list[TripRecord]:
    """Fifteen completed illustrative cycles per truck, ordered by completion.

    All values and IDs are deterministic. The supplied end timestamp anchors
    the fixture to the simulator's shift without pretending it is live history.
    Retry only rounded efficiency collisions, using the same physical model.
    """
    trips = []
    for index in range(fleet_size):
        vehicle_id = f"DUMPER_{index + 1:02d}"
        rng = Random(f"{seed}:baseline:{index}")
        vehicle_trips = []
        displayed_efficiencies = set()
        for cycle in range(1, BASELINE_TRIPS_PER_VEHICLE + 1):
            plan = cycle_plan(index, cycle, seed)
            while True:
                loaded_km = round(rng.uniform(0.75, 1.20), 3)
                empty_km = round(rng.uniform(0.65, 1.10), 3)
                loading_s = round(rng.uniform(140, 230) * plan.loading_scale, 1)
                dumping_s = round(rng.uniform(75, 125) * plan.dumping_scale, 1)
                loaded_s = round(loaded_km / rng.uniform(10, 19) * 3600, 1)
                empty_s = round(empty_km / rng.uniform(16, 26) * 3600, 1)
                idle_s = round(rng.uniform(20, 190), 1)
                distance_km = round(loaded_km + empty_km, 3)
                fuel = estimate_fuel_litres(
                    payload_tonnes=plan.payload_tonnes, loaded_distance_km=loaded_km,
                    empty_distance_km=empty_km, travel_s=loaded_s + empty_s,
                    loading_s=loading_s, dumping_s=dumping_s, idle_s=idle_s,
                    fuel_factor=plan.fuel_factor,
                )
                efficiency = round(plan.payload_tonnes * distance_km / fuel, 2)
                if efficiency not in displayed_efficiencies:
                    displayed_efficiencies.add(efficiency)
                    break
            duration_s = round(loading_s + dumping_s + loaded_s + empty_s + idle_s, 1)
            vehicle_trips.append(TripRecord(
                trip_id=f"SIM-BASELINE-{vehicle_id}-{cycle:03d}", vehicle_id=vehicle_id,
                callsign=f"Mine dumper #{index + 1:02d}", source="SIMULATED",
                pickup_node="PICKUP_NORTH_BENCH", dump_node="DUMP_PRIMARY_CRUSHER",
                payload_tonnes=plan.payload_tonnes, start_time_ms=0, end_time_ms=0,
                cycle_duration_s=duration_s, loading_wait_s=loading_s,
                loaded_travel_s=loaded_s, dumping_wait_s=dumping_s,
                empty_return_s=empty_s, idle_s=idle_s, distance_km=distance_km,
                avg_speed_kmh=round(distance_km * 3600 / duration_s, 2),
                fuel_litres_est=fuel,
            ))
        # Each truck has sequential, non-overlapping cycles ending before startup.
        cursor = end_time_ms - index * 23_000
        for trip in reversed(vehicle_trips):
            trip.end_time_ms = cursor
            trip.start_time_ms = cursor - round(trip.cycle_duration_s * 1000)
            cursor = trip.start_time_ms
        trips.extend(vehicle_trips)
    return sorted(trips, key=lambda trip: (trip.end_time_ms, trip.trip_id))
