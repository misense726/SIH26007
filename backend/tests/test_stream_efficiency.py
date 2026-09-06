from unittest.mock import patch

import pytest

from backend.app.models import WorldState
from backend.app.twin.world_store import WorldStore


@pytest.mark.asyncio
async def test_stream_reuses_one_encoded_snapshot_until_world_changes():
    store = WorldStore(WorldState(sequence=1))
    with patch.object(
        WorldState, "model_dump_json", autospec=True, return_value='{"sequence":1}'
    ) as encode:
        first = await store.stream_snapshot(-1)
        for _ in range(100):
            assert await store.stream_snapshot(1) is None
            assert await store.stream_snapshot(-1) is first
        assert encode.call_count == 1
    await store.replace(WorldState(sequence=2))
    assert (await store.stream_snapshot(1))[0] == 2


@pytest.mark.asyncio
async def test_stream_cache_is_invalidated_by_mutation():
    store = WorldStore(WorldState(sequence=1))
    await store.stream_snapshot(-1)
    await store.update(lambda state: state.model_copy(update={"sequence": 2}))
    assert '"sequence":2' in (await store.stream_snapshot(1))[1]
