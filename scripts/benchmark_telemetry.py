"""Compare the old polling path with cached streaming; no server needed."""

import asyncio
import time
import tracemalloc

from backend.app.models import SpatialPoint, WorldState
from backend.app.twin.world_store import WorldStore


async def measure() -> None:
    store = WorldStore(
        WorldState(
            sequence=1,
            spatial_points=[
                SpatialPoint(x_m=i / 10, y_m=2, source_sensor_id="front_scanner")
                for i in range(600)
            ],
        )
    )
    for label in ("snapshot polling", "cached streaming"):
        tracemalloc.start()
        started = time.perf_counter()
        last_sequence = -1
        for _ in range(100):
            if label == "snapshot polling":
                state = await store.snapshot()
                if state.sequence != last_sequence:
                    state.model_dump_json()
                    last_sequence = state.sequence
            else:
                snapshot = await store.stream_snapshot(last_sequence)
                if snapshot is not None:
                    last_sequence = snapshot[0]
        elapsed = (time.perf_counter() - started) * 1000
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        print(
            f"{label}: {elapsed:.1f} ms / 100 reads; peak temporary allocation {peak / 1024:.1f} KiB"
        )


if __name__ == "__main__":
    asyncio.run(measure())
