from __future__ import annotations

import asyncio
from collections.abc import Callable

from backend.app.models import WorldState


StateMutator = Callable[[WorldState], WorldState]


class WorldStore:
    """The single backend-owned state rendered by every FogSen client."""

    def __init__(self, initial_state: WorldState | None = None) -> None:
        self._state = initial_state or WorldState()
        self._lock = asyncio.Lock()
        self._encoded: tuple[int, str] | None = None

    async def sequence(self) -> int:
        async with self._lock:
            return self._state.sequence

    async def stream_snapshot(self, after_sequence: int) -> tuple[int, str] | None:
        """Encode each revision once, shared by all connected telemetry clients."""
        async with self._lock:
            if self._state.sequence == after_sequence:
                return None
            if self._encoded is None:
                self._encoded = (self._state.sequence, self._state.model_dump_json())
            return self._encoded

    async def snapshot(self) -> WorldState:
        async with self._lock:
            return self._state.model_copy(deep=True)

    async def replace(self, state: WorldState) -> WorldState:
        async with self._lock:
            self._state = state.model_copy(deep=True)
            self._encoded = None
            return self._state.model_copy(deep=True)

    async def update(self, mutator: StateMutator) -> WorldState:
        async with self._lock:
            candidate = mutator(self._state.model_copy(deep=True))
            self._state = WorldState.model_validate(candidate)
            self._encoded = None
            return self._state.model_copy(deep=True)
