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

    async def snapshot(self) -> WorldState:
        async with self._lock:
            return self._state.model_copy(deep=True)

    async def replace(self, state: WorldState) -> WorldState:
        async with self._lock:
            self._state = state.model_copy(deep=True)
            return self._state.model_copy(deep=True)

    async def update(self, mutator: StateMutator) -> WorldState:
        async with self._lock:
            candidate = mutator(self._state.model_copy(deep=True))
            self._state = WorldState.model_validate(candidate)
            return self._state.model_copy(deep=True)

