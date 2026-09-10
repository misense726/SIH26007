from __future__ import annotations

import threading
import time
from typing import Sequence

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

    def __init__(self, max_history: int = 200, seed_baseline: bool = True) -> None:
        self.max_history = max_history
        self._lock = threading.Lock()
        self._trips: list[TripRecord] = []
        self._delay_events: list[str] = []
        if seed_baseline:
            self._seed_shift_baseline_trips()

    def _seed_shift_baseline_trips(self) -> None:
        """Seed realistic completed trips for the current shift at NMDC Bailadila."""
        base_time = _now_ms() - (3 * 3600 * 1000)  # 3 hours ago

        seed_data = [
            ("DUMPER_01", "Bailadila Shovel Hauler #01", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 100.0, 18.2, 3.4, 5.8, 2.1, 4.9, 2.0, 1.45),
            ("DUMPER_02", "Komatsu 930E #02", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 95.0, 17.5, 3.1, 5.5, 1.9, 5.0, 2.0, 1.45),
            ("DUMPER_03", "CAT 793F #03", "PICKUP_EAST_PIT", "DUMP_WASTE_SOUTH", 105.0, 22.0, 4.2, 7.1, 2.5, 6.2, 2.0, 1.82),
            ("HAULER_04", "BEML BH205E #04", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 90.0, 16.8, 2.9, 5.3, 1.8, 4.8, 2.0, 1.45),
            ("DUMPER_01", "Bailadila Shovel Hauler #01", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 100.0, 18.0, 3.2, 5.9, 2.0, 4.9, 2.0, 1.45),
            ("DUMPER_02", "Komatsu 930E #02", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 95.0, 17.8, 3.0, 5.6, 2.1, 5.1, 2.0, 1.45),
            ("DUMPER_03", "CAT 793F #03", "PICKUP_EAST_PIT", "DUMP_WASTE_SOUTH", 105.0, 21.5, 3.9, 7.0, 2.4, 6.2, 2.0, 1.82),
            ("HAULER_04", "BEML BH205E #04", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 90.0, 16.5, 2.8, 5.2, 1.7, 4.8, 2.0, 1.45),
            ("DUMPER_01", "Bailadila Shovel Hauler #01", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 100.0, 18.5, 3.5, 6.0, 2.1, 4.9, 2.0, 1.45),
            ("DUMPER_02", "Komatsu 930E #02", "PICKUP_NORTH_BENCH", "DUMP_PRIMARY_CRUSHER", 95.0, 17.2, 3.0, 5.4, 1.9, 4.9, 2.0, 1.45),
        ]

        for i, (vid, call, pickup, dump, payload, dur_min, load_m, l_trav_m, dump_m, e_ret_m, idle_m, dist_km) in enumerate(seed_data):
            t_start = base_time + (i * 15 * 60 * 1000)
            t_end = t_start + int(dur_min * 60 * 1000)
            rec = TripRecord(
                trip_id=f"TRIP-BENCH-{1000 + i}",
                vehicle_id=vid,
                callsign=call,
                pickup_node=pickup,
                dump_node=dump,
                payload_tonnes=payload,
                start_time_ms=t_start,
                end_time_ms=t_end,
                cycle_duration_s=round(dur_min * 60.0, 1),
                loading_wait_s=round(load_m * 60.0, 1),
                loaded_travel_s=round(l_trav_m * 60.0, 1),
                dumping_wait_s=round(dump_m * 60.0, 1),
                empty_return_s=round(e_ret_m * 60.0, 1),
                idle_s=round(idle_m * 60.0, 1),
                distance_km=dist_km,
                avg_speed_kmh=round(dist_km / (dur_min / 60.0), 1),
                route_deviations_count=0,
                route_compliance_pct=100.0,
                fuel_litres_est=round(dist_km * 4.1 + (payload * 0.08), 1),
            )
            self._trips.append(rec)

    def record_trip(self, trip: TripRecord) -> None:
        with self._lock:
            self._trips.append(trip)
            if len(self._trips) > self.max_history:
                self._trips.pop(0)

    def get_trip_history(self, limit: int = 50) -> TripHistoryResponse:
        with self._lock:
            trips_slice = list(reversed(self._trips[-limit:]))
            total_t = sum(t.payload_tonnes for t in self._trips)
            return TripHistoryResponse(
                trips=trips_slice,
                total_trips=len(self._trips),
                total_tonnes=round(total_t, 1),
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
            ore_by_veh[t.vehicle_id] = round(ore_by_veh.get(t.vehicle_id, 0.0) + t.payload_tonnes, 1)
            cycles_by_veh[t.vehicle_id] = cycles_by_veh.get(t.vehicle_id, 0) + 1

        # Production rate: tonnes per hour based on observed span of trips
        min_start = min(t.start_time_ms for t in trips)
        max_end = max(t.end_time_ms for t in trips)
        span_ms = max_end - min_start
        span_hours = span_ms / 3_600_000.0 if span_ms > 0 else (sum(t.cycle_duration_s for t in trips) / 3600.0)
        hourly_rate = round(total_tonnes / max(0.1, span_hours), 1)

        avg_compliance = sum(t.route_compliance_pct for t in trips) / total_cycles

        delays = list(self._delay_events) if self._delay_events else [
            "Dense fog speed regulation on North Incline (average 3.2m travel delay)",
            "Gyratory Crusher bin hopper queuing observed at 08:45 AM",
            "Shovel #04 repositioning pause (2.5m wait recorded)",
        ]

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
