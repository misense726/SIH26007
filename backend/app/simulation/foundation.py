from __future__ import annotations

import asyncio
import math
from contextlib import suppress
from pathlib import Path

from backend.app.models import (
    DataMode,
    EnvironmentState,
    MapFeatureType,
    RangeReading,
    ReferenceMap,
    SafeCorridor,
    SensorHealth,
    VehiclePose,
    VisibilityState,
    WorldState,
)
from backend.app.models.telemetry import now_ms
from backend.app.twin.map_store import load_reference_map, save_reference_map
from backend.app.twin.route import PolylineRoute
from backend.app.twin.world_store import WorldStore


class FoundationSimulator:
    """Small deterministic telemetry source used by the M0 vertical slice."""

    SENSOR_IDS = (
        "front_scanner",
        "rear_scanner",
        "front_left",
        "front_right",
        "left_side",
        "right_side",
    )

    def __init__(
        self,
        store: WorldStore,
        telemetry_hz: float = 10.0,
        map_path: str | Path = "maps/test_route.json",
        route_speed_mps: float = 1.15,
    ) -> None:
        self._store = store
        self._interval_s = 1.0 / telemetry_hz
        self._map_path = Path(map_path)
        self._reference_map = load_reference_map(self._map_path)
        route_feature = self._reference_map.feature(MapFeatureType.ROUTE)
        if route_feature is None:
            raise ValueError("Reference map does not contain a ROUTE feature")
        self._route = PolylineRoute(route_feature.points)
        self._route_speed_mps = route_speed_mps
        self._route_distance_m = 0.0
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._phase = 0.0

    @property
    def running(self) -> bool:
        return self._running

    @property
    def reference_map(self) -> ReferenceMap:
        return self._reference_map.model_copy(deep=True)

    async def set_reference_map(self, reference_map: ReferenceMap) -> None:
        route_feature = reference_map.feature(MapFeatureType.ROUTE)
        if route_feature is None:
            raise ValueError("Reference map does not contain a ROUTE feature")
        route = PolylineRoute(route_feature.points)
        save_reference_map(reference_map, self._map_path)
        self._reference_map = reference_map.model_copy(deep=True)
        self._route = route
        self._route_distance_m = 0.0

    async def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._run(), name="fogsen-foundation-simulator")

    async def stop(self) -> None:
        self._running = False
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def tick(self) -> WorldState:
        timestamp = now_ms()
        self._phase = (self._phase + self._interval_s) % 60.0
        remaining_m = max(0.0, self._route.total_length_m - self._route_distance_m)
        travelled_m = min(self._route_speed_mps * self._interval_s, remaining_m)
        self._route_distance_m += travelled_m
        speed = travelled_m / self._interval_s
        route_sample = self._route.sample(self._route_distance_m)
        range_base = 2.25 + 0.18 * math.sin(self._phase)
        ranges = [
            RangeReading(
                timestamp_ms=timestamp,
                sensor_id=sensor_id,
                angle_deg=0.0,
                range_m=max(0.1, range_base + index * 0.08),
                quality=0.96,
            )
            for index, sensor_id in enumerate(self.SENSOR_IDS)
        ]
        health = [
            SensorHealth(sensor_id=sensor_id, last_update_ms=timestamp)
            for sensor_id in self.SENSOR_IDS
        ]
        current = await self._store.snapshot()
        state = WorldState(
            generated_at_ms=timestamp,
            sequence=current.sequence + 1,
            mode=DataMode.SIMULATED,
            vehicles=[
                VehiclePose(
                    timestamp_ms=timestamp,
                    x_m=route_sample.x_m,
                    y_m=route_sample.y_m,
                    heading_deg=route_sample.heading_deg,
                    speed_mps=speed,
                    position_confidence=0.98,
                )
            ],
            reference_map=self._reference_map,
            ranges=ranges,
            environment=EnvironmentState(
                timestamp_ms=timestamp,
                temperature_c=26.4,
                pressure_hpa=1007.8,
                relative_altitude_m=0.0,
                visibility_score=0.88,
                visibility_state=VisibilityState.GOOD,
            ),
            sensor_health=health,
            safe_corridor=SafeCorridor(
                reason="Road loaded; corridor evaluation begins in M11",
            ),
        )
        return await self._store.replace(state)

    async def _run(self) -> None:
        while self._running:
            started = asyncio.get_running_loop().time()
            await self.tick()
            elapsed = asyncio.get_running_loop().time() - started
            await asyncio.sleep(max(0.0, self._interval_s - elapsed))
