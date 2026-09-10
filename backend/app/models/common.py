from __future__ import annotations

import time
from pydantic import BaseModel, ConfigDict


def now_ms() -> int:
    return time.time_ns() // 1_000_000


class TelemetryModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Point2D(TelemetryModel):
    x_m: float
    y_m: float
