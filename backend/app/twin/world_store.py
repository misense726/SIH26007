from __future__ import annotations

import asyncio
from collections.abc import Callable

from backend.app.models import WorldState
from backend.app.models.common import now_ms
from backend.app.models.device import VehicleTelemetry, VehicleTelemetryPacket
from backend.app.models.telemetry import DataMode


StateMutator = Callable[[WorldState], WorldState]


class WorldStore:
    """The single backend-owned state rendered by every MI Sense client."""

    def __init__(self, initial_state: WorldState | None = None) -> None:
        self._state = initial_state or WorldState()
        self._lock = asyncio.Lock()
        self._encoded: tuple[int, str] | None = None
        self._devices: dict[str, VehicleTelemetry] = {}

    def _refresh_devices(self) -> None:
        if self._state.mode != DataMode.LIVE:
            return
        devices = []
        timestamp = now_ms()
        for sample in self._devices.values():
            item = sample.model_copy(deep=True)
            elapsed = max(0, timestamp - sample.received_at_ms)
            item.online = elapsed <= 5000
            if not item.online or item.gps.age is None or item.gps.age + elapsed > 5000:
                item.gps.fix = False
                item.gps.lat = item.gps.lon = item.gps.alt_m = item.gps.speed_mps = item.gps.hdop = None
            if item.load and (not item.online or item.load.age is None or item.load.age + elapsed > 1000):
                item.load.ready = False
                item.load.raw = item.load.kg = None
            devices.append(item)
        if self._state.vehicle_telemetry != devices:
            self._state.vehicle_telemetry = devices
            self._state.sequence += 1
            self._encoded = None

    async def accept_vehicle(self, packet: VehicleTelemetryPacket, received_at_ms: int | None = None) -> None:
        async with self._lock:
            self._devices[packet.vehicle_id] = VehicleTelemetry(
                **packet.model_dump(), received_at_ms=received_at_ms or now_ms()
            )
            self._refresh_devices()

    async def sequence(self) -> int:
        async with self._lock:
            self._refresh_devices()
            return self._state.sequence

    async def stream_snapshot(self, after_sequence: int) -> tuple[int, str] | None:
        """Encode each revision once, shared by all connected telemetry clients."""
        async with self._lock:
            self._refresh_devices()
            if self._state.sequence == after_sequence:
                return None
            if self._encoded is None:
                self._encoded = (self._state.sequence, self._state.model_dump_json())
            return self._encoded

    async def snapshot(self) -> WorldState:
        async with self._lock:
            self._refresh_devices()
            return self._state.model_copy(deep=True)

    async def replace(self, state: WorldState) -> WorldState:
        async with self._lock:
            self._state = state.model_copy(deep=True)
            self._refresh_devices()
            self._encoded = None
            return self._state.model_copy(deep=True)

    async def publish(
        self,
        candidate: WorldState,
        generated_at_ms: int | None = None,
    ) -> WorldState:
        """Publish one state revision while preserving monotonic sequencing."""
        async with self._lock:
            next_sequence = self._state.sequence + 1
            timestamp = generated_at_ms if generated_at_ms is not None else now_ms()
            candidate.sequence = next_sequence
            candidate.generated_at_ms = timestamp
            self._state = WorldState.model_validate(candidate)
            self._refresh_devices()
            self._encoded = None
            return self._state.model_copy(deep=True)

    async def update(self, mutator: StateMutator) -> WorldState:
        async with self._lock:
            candidate = mutator(self._state.model_copy(deep=True))
            self._state = WorldState.model_validate(candidate)
            self._refresh_devices()
            self._encoded = None
            return self._state.model_copy(deep=True)
