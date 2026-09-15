"""Backend-owned loading, tipping and empty-return cycles for every dumper."""

from dataclasses import dataclass, field
import math
from bisect import bisect_right
from itertools import accumulate

from backend.app.analytics.simulated_haul import HaulCyclePlan, cycle_plan, estimate_fuel_litres
from backend.app.fleet.models import TripRecord
from backend.app.models import VehiclePose
from backend.app.models.operations import HaulCycleState, VehicleOperationalMetadata
from backend.app.models.telemetry import HaulVehicleState, HaulRouteState


@dataclass
class CycleAccounting:
    loading_s: float = 0.0
    loaded_travel_s: float = 0.0
    dumping_s: float = 0.0
    empty_return_s: float = 0.0
    idle_s: float = 0.0
    loaded_distance_m: float = 0.0
    empty_distance_m: float = 0.0


@dataclass
class Truck:
    distance: float
    plan: HaulCyclePlan
    phase: str = "QUEUED"
    timer: float = 0.0
    payload: float = 0.0
    speed: float = 0.0
    cycle: int = 1
    trip_number: int = 1
    accounting: CycleAccounting = field(default_factory=CycleAccounting)


class HaulFleet:
    def __init__(self, route, dump_distance: float, config: dict, elevations: list[float]):
        self.route, self.dump_distance, self.config = route, dump_distance, config
        self.elevations = elevations
        self.distances = [0.0, *accumulate(route.segment_lengths)]
        self.trucks = [Truck(route.total_length_m - i * config["queue_spacing_m"], cycle_plan(i, 1))
                       for i in range(config["fleet_size"])]
        self.elapsed = 0.0
        stop = route.sample(dump_distance)
        heading = math.radians(stop.heading_deg)
        self.docking_curve = [
            (stop.x_m, stop.y_m),
            (stop.x_m - 3 * math.sin(heading), stop.y_m - 3 * math.cos(heading)),
            (stop.x_m + 2, stop.y_m - 4),
            (stop.x_m + 5, stop.y_m - 4),
        ]
        self.docking_length = sum(math.dist(self.dock_pose(i / 32)[:2], self.dock_pose((i + 1) / 32)[:2])
                                  for i in range(32))

    def dock_pose(self, t):
        """Reverse into the off-road bay; the vehicle faces opposite the curve tangent."""
        a, b, c, d = self.docking_curve
        u = 1 - t
        xy = [u**3 * a[i] + 3*u*u*t*b[i] + 3*u*t*t*c[i] + t**3*d[i] for i in (0, 1)]
        tangent = [3*u*u*(b[i]-a[i]) + 6*u*t*(c[i]-b[i]) + 3*t*t*(d[i]-c[i]) for i in (0, 1)]
        return (*xy, math.degrees(math.atan2(-tangent[0], -tangent[1])) % 360)

    def set_trip_numbers(self, numbers: dict[str, int]) -> None:
        """Resume the deterministic load sequence when HAUL is selected again."""
        for index, truck in enumerate(self.trucks):
            truck.trip_number = numbers.get(f"DUMPER_{index + 1:02d}", 1)
            truck.plan = cycle_plan(index, truck.trip_number)

    def duration(self, truck: Truck, phase: str) -> float:
        if phase == "LOADING":
            return self.config["loading_s"] * truck.plan.loading_scale
        if phase == "DUMPING":
            return self.config["dumping_s"] * truck.plan.dumping_scale
        if phase in {"REVERSING", "EXITING"}:
            return self.config["reversing_s"]
        return self.config["lowering_s"] if phase == "LOWERING" else 1.0

    def advance(
        self, dt: float, running: bool, cruise: float, timestamp_ms: int | None = None,
        *, emergency_stopped: bool = False,
    ) -> list[TripRecord]:
        completed = []
        if not running or dt <= 0:
            for truck in self.trucks:
                truck.speed = 0.0
            return completed
        self.elapsed += dt
        if emergency_stopped:
            # An operational stop is real simulated downtime, unlike playback pause.
            for truck in self.trucks:
                truck.speed = 0.0
                truck.accounting.idle_s += dt
            return completed
        timestamp_ms = timestamp_ms if timestamp_ms is not None else round(self.elapsed * 1000)
        loading = next((i for i, t in enumerate(self.trucks) if t.phase == "LOADING"), None)
        tipping = next((i for i, t in enumerate(self.trucks)
                        if t.phase in {"REVERSING", "DUMPING", "LOWERING", "EXITING"}), None)
        for index, truck in enumerate(self.trucks):
            truck.speed = 0.0
            if truck.phase == "QUEUED":
                ahead = [t.distance for t in self.trucks if t is not truck
                         and t.phase in {"QUEUED", "RETURNING"} and t.distance > truck.distance]
                limit = min(ahead) - self.config["queue_spacing_m"] if ahead else self.route.total_length_m
                if loading is not None:
                    limit = min(limit, self.route.total_length_m - self.config["queue_spacing_m"])
                self._move(truck, limit, cruise, dt)
                if truck.distance >= self.route.total_length_m - 1e-6 and loading is None:
                    truck.distance = 0.0
                    truck.phase, truck.timer = "LOADING", 0.0
                    truck.speed = 0.0
                    loading = index
            elif truck.phase == "LOADING":
                truck.timer += dt
                truck.accounting.loading_s += dt
                duration = self.duration(truck, "LOADING")
                truck.payload = truck.plan.payload_fraction * min(1.0, truck.timer / duration)
                if truck.timer >= duration:
                    truck.phase, truck.timer = "HAULING", 0.0
            elif truck.phase in {"HAULING", "RETURNING"}:
                limit = self.dump_distance if truck.phase == "HAULING" else self.route.total_length_m
                ahead = [t.distance for t in self.trucks if t is not truck
                         and t.distance > truck.distance and t.distance <= limit]
                if ahead:
                    limit = min(limit, min(ahead) - self.config["queue_spacing_m"])
                if truck.phase == "HAULING" and tipping is not None:
                    limit = min(limit, self.dump_distance - self.config["queue_spacing_m"])
                if truck.phase == "RETURNING" and loading is not None:
                    limit = min(limit, self.route.total_length_m - self.config["queue_spacing_m"])
                self._move(truck, limit, cruise, dt)
                if truck.phase == "HAULING" and truck.distance >= self.dump_distance - 1e-6 and tipping is None:
                    truck.phase, truck.timer = "REVERSING", 0.0
                    tipping = index
                elif truck.phase == "RETURNING" and truck.distance >= self.route.total_length_m - 1e-6:
                    completed.append(self._completed_trip(index, timestamp_ms))
                    truck.phase, truck.timer = "QUEUED", 0.0
                    truck.cycle += 1
                    truck.trip_number += 1
                    truck.plan = cycle_plan(index, truck.trip_number)
                    truck.accounting = CycleAccounting()
            else:
                duration = self.duration(truck, truck.phase)
                remaining_s = max(0.0, duration - truck.timer)
                truck.timer += dt
                truck.accounting.dumping_s += dt
                if truck.phase == "DUMPING":
                    truck.payload = truck.plan.payload_fraction * (1 - max(0.0, min(1.0, (truck.timer / duration - 0.3) / 0.6)))
                if truck.phase in {"REVERSING", "EXITING"}:
                    truck.speed = self.docking_length / duration
                    distance = truck.speed * min(dt, remaining_s)
                    if truck.phase == "REVERSING":
                        truck.accounting.loaded_distance_m += distance
                    else:
                        truck.accounting.empty_distance_m += distance
                if truck.timer >= duration:
                    truck.phase = {"REVERSING": "DUMPING", "DUMPING": "LOWERING",
                                   "LOWERING": "EXITING", "EXITING": "RETURNING"}[truck.phase]
                    truck.timer = 0.0
                    truck.speed = 0.0
        return completed

    def _move(self, truck, limit, cruise, dt):
        cruise *= truck.plan.speed_scale
        before = self.route.sample(max(0, truck.distance - 0.5))
        after = self.route.sample(min(self.route.total_length_m, truck.distance + 0.5))
        turn = abs(math.radians((after.heading_deg - before.heading_deg + 180) % 360 - 180))
        if turn > 0.01:
            cruise = min(cruise, self.config.get("max_turn_rate_rad_s", 1.2) / turn)
        step = min(cruise * dt, max(0.0, limit - truck.distance))
        truck.distance += step
        truck.speed = step / dt
        accounting = truck.accounting
        if step <= 0:
            accounting.idle_s += dt
        elif truck.phase == "HAULING":
            accounting.loaded_distance_m += step
            accounting.loaded_travel_s += dt
        else:
            accounting.empty_distance_m += step
            accounting.empty_return_s += dt

    def _completed_trip(self, index: int, timestamp_ms: int) -> TripRecord:
        truck = self.trucks[index]
        a = truck.accounting
        duration = round(a.loading_s + a.loaded_travel_s + a.dumping_s + a.empty_return_s + a.idle_s, 3)
        distance = round((a.loaded_distance_m + a.empty_distance_m) / 1000, 6)
        vehicle_id = f"DUMPER_{index + 1:02d}"
        return TripRecord(
            trip_id=f"SIM-HAUL-{vehicle_id}-{truck.trip_number:06d}",
            vehicle_id=vehicle_id, callsign=f"Mine dumper #{index + 1:02d}", source="SIMULATED",
            pickup_node="PICKUP_NORTH_BENCH", dump_node="DUMP_PRIMARY_CRUSHER",
            payload_tonnes=truck.plan.payload_tonnes,
            start_time_ms=timestamp_ms - round(duration * 1000), end_time_ms=timestamp_ms,
            cycle_duration_s=duration, loading_wait_s=round(a.loading_s, 3),
            loaded_travel_s=round(a.loaded_travel_s, 3), dumping_wait_s=round(a.dumping_s, 3),
            empty_return_s=round(a.empty_return_s, 3), idle_s=round(a.idle_s, 3),
            distance_km=distance, avg_speed_kmh=round(distance * 3600 / max(duration, 0.001), 2),
            fuel_litres_est=estimate_fuel_litres(
                payload_tonnes=truck.plan.payload_tonnes, loaded_distance_km=a.loaded_distance_m / 1000,
                empty_distance_km=a.empty_distance_m / 1000, travel_s=a.loaded_travel_s + a.empty_return_s,
                loading_s=a.loading_s, dumping_s=a.dumping_s, idle_s=a.idle_s,
                fuel_factor=truck.plan.fuel_factor,
            ),
        )

    def operational_metadata(self, index: int) -> VehicleOperationalMetadata:
        truck = self.trucks[index]
        returning = truck.phase in {"QUEUED", "LOADING", "RETURNING"}
        states = {"QUEUED": HaulCycleState.WAITING_FOR_LOADING,
                  "LOADING": HaulCycleState.WAITING_FOR_LOADING,
                  "HAULING": HaulCycleState.TRAVELLING_TO_DUMP,
                  "REVERSING": HaulCycleState.WAITING_FOR_DUMP,
                  "DUMPING": HaulCycleState.DUMPING, "LOWERING": HaulCycleState.DUMPING,
                  "EXITING": HaulCycleState.RETURNING_EMPTY, "RETURNING": HaulCycleState.RETURNING_EMPTY}
        payload = round(truck.payload * truck.plan.capacity_tonnes, 2)
        return VehicleOperationalMetadata(
            vehicle_id=f"DUMPER_{index + 1:02d}", callsign=f"Mine dumper #{index + 1:02d}",
            is_primary=index == 0, is_simulated=True, cycle_state=states[truck.phase],
            payload_tonnes=payload, tare_weight_tonnes=85.0, total_weight_tonnes=85.0 + payload,
            elevation_m=self.height(truck.distance), assigned_pickup="Pit loading bay",
            assigned_dump="Crusher", current_destination="Pit loading bay" if returning else "Crusher",
            distance_to_destination_m=(0.0 if truck.phase == "LOADING" else max(0.0,
                (self.route.total_length_m if returning else self.dump_distance) - truck.distance)),
            next_instruction=truck.phase.replace("_", " ").capitalize(),
            target_payload_tonnes=truck.plan.capacity_tonnes,
        )

    def pose(self, index: int, timestamp: int) -> VehiclePose:
        truck = self.trucks[index]
        point = self.route.sample(truck.distance)
        duration = self.duration(truck, truck.phase)
        progress = min(1.0, truck.timer / duration)
        dock = (progress if truck.phase == "REVERSING" else 1 - progress if truck.phase == "EXITING"
                else 1.0 if truck.phase in {"DUMPING", "LOWERING"} else 0.0)
        bed = (58 * min(1.0, progress / 0.3) if truck.phase == "DUMPING"
               else 58 * (1 - progress) if truck.phase == "LOWERING" else 0.0)
        docking = truck.phase in {"REVERSING", "DUMPING", "LOWERING", "EXITING"}
        x, y, heading_deg = self.dock_pose(dock) if docking else (point.x_m, point.y_m, point.heading_deg)
        return VehiclePose(vehicle_id=f"DUMPER_{index + 1:02d}", timestamp_ms=timestamp,
            x_m=x, y_m=y,
            heading_deg=heading_deg, speed_mps=truck.speed, position_confidence=1.0,
            haul=HaulVehicleState(phase=truck.phase, payload_fraction=truck.payload,
                                  payload_tonnes=round(truck.payload * truck.plan.capacity_tonnes, 2),
                                  payload_target_tonnes=truck.plan.payload_tonnes,
                                  payload_capacity_tonnes=truck.plan.capacity_tonnes,
                                  bed_angle_deg=bed, phase_progress=progress, cycle=truck.cycle,
                                  road_elevation_m=self.height(truck.distance),
                                  road_pitch_deg=0 if docking else max(-8, min(8, math.degrees(math.atan2(
                                      self.height(truck.distance + 1) - self.height(truck.distance - 1), 2))))))

    def height(self, distance):
        distance = max(0.0, min(self.route.total_length_m, distance))
        i = min(len(self.elevations) - 2, max(0, bisect_right(self.distances, distance) - 1))
        t = (distance - self.distances[i]) / self.route.segment_lengths[i]
        return self.elevations[i] + t * (self.elevations[i + 1] - self.elevations[i])

    def snapshot(self) -> HaulRouteState:
        truck = self.trucks[0]
        returning = truck.phase in {"LOWERING", "EXITING", "RETURNING"}
        end = self.route.total_length_m if returning else self.dump_distance
        instruction = {"QUEUED": "Waiting to load iron ore", "LOADING": "Loading iron ore at pit floor",
                       "HAULING": "Climbing to the crusher", "REVERSING": "Reversing into tipping bay",
                       "DUMPING": "Tipping iron ore into crusher", "LOWERING": "Lowering empty bed",
                       "EXITING": "Leaving tipping bay", "RETURNING": "Returning empty to pit floor"}[truck.phase]
        return HaulRouteState(origin="Crusher" if returning else "Pit loading bay",
            destination="Mine loading bay" if returning else "Dump point", cycle=truck.cycle,
            phase="HAULING" if truck.speed else "ARRIVED", distance_m=truck.distance,
            total_distance_m=self.route.total_length_m, remaining_m=max(0.0, end - truck.distance),
            elapsed_s=self.elapsed, next_instruction=instruction)
