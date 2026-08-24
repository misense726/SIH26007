from __future__ import annotations

import asyncio
import math
from contextlib import suppress

from backend.app.models import (
    DataMode,
    EnvironmentState,
    RangeReading,
    SensorHealth,
    VehiclePose,
    VisibilityState,
    WorldState,
)
from backend.app.models.telemetry import now_ms
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

    def __init__(self, store: WorldStore, telemetry_hz: float = 10.0) -> None:
        self._store = store
        self._interval_s = 1.0 / telemetry_hz
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._phase = 0.0

    @property
    def running(self) -> bool:
        return self._running

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
        heading = (self._phase * 4.0) % 360.0
        speed = 0.8 + 0.12 * math.sin(self._phase * 0.8)
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
            vehicle=VehiclePose(
                timestamp_ms=timestamp,
                x_m=1.0 + 0.2 * math.sin(self._phase * 0.2),
                y_m=1.0 + self._phase * 0.03,
                heading_deg=heading,
                speed_mps=speed,
                position_confidence=0.98,
            ),
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
        )
        return await self._store.replace(state)

    async def _run(self) -> None:
        while self._running:
            started = asyncio.get_running_loop().time()
            await self.tick()
            elapsed = asyncio.get_running_loop().time() - started
            await asyncio.sleep(max(0.0, self._interval_s - elapsed))

