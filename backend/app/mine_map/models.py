from __future__ import annotations

from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class NodeType(StrEnum):
    BENCH = "BENCH"
    DUMP = "DUMP"
    JUNCTION = "JUNCTION"
    WAYPOINT = "WAYPOINT"


class RoadStatus(StrEnum):
    OPEN = "OPEN"
    RESTRICTED = "RESTRICTED"
    CLOSED = "CLOSED"


class MineNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str
    name: str
    x_m: float
    y_m: float
    elevation_m: float
    node_type: NodeType
    description: str = ""


class MineEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edge_id: str
    from_node: str
    to_node: str
    distance_m: float = Field(gt=0.0)
    gradient_pct: float = 0.0  # positive = uphill from from_node to to_node
    max_weight_tonnes: float = Field(default=240.0, gt=0.0)
    road_status: RoadStatus = RoadStatus.OPEN
    speed_limit_kmh: float = Field(default=40.0, gt=0.0)
    risk_penalty: float = Field(default=0.0, ge=0.0)
    lanes: int = Field(default=2, ge=1)
    is_bidirectional: bool = True
    surface: str = "compacted_gravel"
    segment_name: str = ""


class MineNetwork(BaseModel):
    model_config = ConfigDict(extra="forbid")

    network_id: str
    name: str
    mine_site: str
    nodes: dict[str, MineNode]
    edges: dict[str, MineEdge]
