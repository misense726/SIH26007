from __future__ import annotations

from collections import Counter
import threading
import time

from backend.app.analytics.simulated_haul import BASELINE_TRIPS_PER_VEHICLE, baseline_trips

from backend.app.analytics.models import (
    CycleTimeBreakdown,
    HaulageMetrics,
    TripHistoryResponse,
)
from backend.app.fleet.models import TripRecord


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


class HaulageAnalyticsEngine:
    """Logs haul cycles and computes fleet production, cycle time breakdown, and utilization."""

    def __init__(
        self, max_history: int = 200, seed_baseline: bool = True,
        baseline_end_ms: int | None = None, fleet_size: int = 8,
    ) -> None:
        if max_history < 1:
            raise ValueError("max_history must be positive")
        self.max_history = max_history
        self._lock = threading.Lock()
        self._trips: list[TripRecord] = []
        self._delay_events: list[str] = []
        self._seed_baseline = seed_baseline
        self._baseline_end_ms = baseline_end_ms if baseline_end_ms is not None else _now_ms()
        self._fleet_size = fleet_size
        self.reset()

    def reset(self) -> None:
        """Discard runtime trips and restore the same baseline, or empty LIVE history."""
        with self._lock:
            self._trips = (baseline_trips(self._baseline_end_ms, self._fleet_size)
                           if self._seed_baseline else [])
            self._trips = self._trips[-self.max_history:]
            self._delay_events.clear()

    def record_trip(self, trip: TripRecord) -> None:
        with self._lock:
            if any(existing.trip_id == trip.trip_id for existing in self._trips):
                return
            self._trips.append(trip)
            self._trips.sort(key=lambda item: (item.end_time_ms, item.trip_id))
            if len(self._trips) > self.max_history:
                counts = Counter(item.vehicle_id for item in self._trips)
                # A busy truck must not evict the last 15 records of a slower one.
                victim = next((i for i, item in enumerate(self._trips)
                               if counts[item.vehicle_id] > BASELINE_TRIPS_PER_VEHICLE), 0)
                self._trips.pop(victim)

    def get_trip_history(self, limit: int = 50, vehicle_id: str | None = None) -> TripHistoryResponse:
        if not 1 <= limit <= 200:
            raise ValueError("limit must be between 1 and 200")
        with self._lock:
            matching = [trip for trip in self._trips if vehicle_id is None or trip.vehicle_id == vehicle_id]
            return TripHistoryResponse(
                trips=list(reversed(matching[-limit:])),
                total_trips=len(matching),
                total_tonnes=round(sum(trip.payload_tonnes for trip in matching), 1),
            )

    def get_haulage_metrics(self, active_fleet_count: int = 4) -> HaulageMetrics:
        with self._lock:
            trips = list(self._trips)

        if not trips:
            empty_bd = CycleTimeBreakdown(
                loading_wait_minutes=0.0,
                loaded_travel_minutes=0.0,
                dumping_wait_minutes=0.0,
                empty_return_minutes=0.0,
                idle_minutes=0.0,
                total_cycle_minutes=0.0,
                loading_pct=0.0,
                loaded_travel_pct=0.0,
                dumping_pct=0.0,
                empty_return_pct=0.0,
                idle_pct=0.0,
            )
            return HaulageMetrics(
                total_completed_cycles=0,
                total_ore_moved_tonnes=0.0,
                avg_cycle_time_minutes=0.0,
                fleet_utilization_pct=0.0,
                total_distance_km=0.0,
                route_compliance_pct=100.0,
                active_fleet_count=active_fleet_count,
                cycle_time_breakdown=empty_bd,
                ore_moved_by_vehicle={},
                cycles_by_vehicle={},
                hourly_production_rate_tph=0.0,
                recent_delay_events=[],
            )

        total_cycles = len(trips)
        total_tonnes = sum(t.payload_tonnes for t in trips)
        total_distance = sum(t.distance_km for t in trips)

        # Averages in minutes
        avg_loading_min = sum(t.loading_wait_s for t in trips) / (total_cycles * 60.0)
        avg_loaded_travel_min = sum(t.loaded_travel_s for t in trips) / (total_cycles * 60.0)
        avg_dumping_min = sum(t.dumping_wait_s for t in trips) / (total_cycles * 60.0)
        avg_empty_return_min = sum(t.empty_return_s for t in trips) / (total_cycles * 60.0)
        avg_idle_min = sum(t.idle_s for t in trips) / (total_cycles * 60.0)
        avg_total_cycle_min = sum(t.cycle_duration_s for t in trips) / (total_cycles * 60.0)

        tot_m = max(0.1, avg_total_cycle_min)
        breakdown = CycleTimeBreakdown(
            loading_wait_minutes=round(avg_loading_min, 2),
            loaded_travel_minutes=round(avg_loaded_travel_min, 2),
            dumping_wait_minutes=round(avg_dumping_min, 2),
            empty_return_minutes=round(avg_empty_return_min, 2),
            idle_minutes=round(avg_idle_min, 2),
            total_cycle_minutes=round(avg_total_cycle_min, 2),
            loading_pct=round((avg_loading_min / tot_m) * 100.0, 1),
            loaded_travel_pct=round((avg_loaded_travel_min / tot_m) * 100.0, 1),
            dumping_pct=round((avg_dumping_min / tot_m) * 100.0, 1),
            empty_return_pct=round((avg_empty_return_min / tot_m) * 100.0, 1),
            idle_pct=round((avg_idle_min / tot_m) * 100.0, 1),
        )

        # Fleet utilization = percentage of time spent in active haulage (loaded travel + empty return)
        active_time = avg_loaded_travel_min + avg_empty_return_min
        utilization_pct = min(100.0, max(0.0, (active_time / tot_m) * 100.0))
        if active_fleet_count == 0:
            utilization_pct = 0.0

        ore_by_veh: dict[str, float] = {}
        cycles_by_veh: dict[str, int] = {}
        for t in trips:
            ore_by_veh[t.vehicle_id] = ore_by_veh.get(t.vehicle_id, 0.0) + t.payload_tonnes
            cycles_by_veh[t.vehicle_id] = cycles_by_veh.get(t.vehicle_id, 0) + 1
        ore_by_veh = {vehicle_id: round(tonnes, 1) for vehicle_id, tonnes in ore_by_veh.items()}

        # Production rate: tonnes per hour based on observed span of trips
        min_start = min(t.start_time_ms for t in trips)
        max_end = max(t.end_time_ms for t in trips)
        span_ms = max_end - min_start
        span_hours = span_ms / 3_600_000.0 if span_ms > 0 else (sum(t.cycle_duration_s for t in trips) / 3600.0)
        hourly_rate = round(total_tonnes / max(0.1, span_hours), 1)

        avg_compliance = sum(t.route_compliance_pct for t in trips) / total_cycles

        delays = list(self._delay_events)

        return HaulageMetrics(
            total_completed_cycles=total_cycles,
            total_ore_moved_tonnes=round(total_tonnes, 1),
            avg_cycle_time_minutes=round(avg_total_cycle_min, 2),
            fleet_utilization_pct=round(utilization_pct, 1),
            total_distance_km=round(total_distance, 2),
            route_compliance_pct=round(avg_compliance, 1),
            active_fleet_count=active_fleet_count,
            cycle_time_breakdown=breakdown,
            ore_moved_by_vehicle=ore_by_veh,
            cycles_by_vehicle=cycles_by_veh,
            hourly_production_rate_tph=hourly_rate,
            recent_delay_events=delays,
        )
