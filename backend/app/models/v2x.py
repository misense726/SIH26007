from __future__ import annotations

import time
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def now_ms() -> int:
    return time.time_ns() // 1_000_000


class V2XModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class V2XMessageType(str, Enum):
    V2V_BSM = "V2V_BSM"
    V2V_PROXIMITY_ALERT = "V2V_PROXIMITY_ALERT"
    V2I_ADVISORY = "V2I_ADVISORY"
    V2I_INTERSECTION_PRIORITY = "V2I_INTERSECTION_PRIORITY"
    V2I_EMERGENCY_BROADCAST = "V2I_EMERGENCY_BROADCAST"


class V2IAdvisoryType(str, Enum):
    FOG_WARNING = "FOG_WARNING"
    SPEED_RESTRICTION = "SPEED_RESTRICTION"
    HAZARD_ZONE = "HAZARD_ZONE"
    PASSAGE_PRIORITY = "PASSAGE_PRIORITY"
    DISPATCH = "DISPATCH"
    ROAD_MAINTENANCE = "ROAD_MAINTENANCE"


class V2VBasicSafetyMessage(V2XModel):
    """V2V Basic Safety Message (BSM) broadcasted continuously by vehicles."""

    message_id: str
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    vehicle_id: str
    x_m: float
    y_m: float
    heading_deg: float
    speed_mps: float = Field(ge=0.0)
    emergency_state: str = "SAFE"
    corridor_state: str = "GREEN"
    nearest_obstacle_m: float | None = None
    brake_applied: bool = False


class V2IAdvisoryMessage(V2XModel):
    """V2I Advisory message broadcasted by Roadside Units or Central Supervisor."""

    message_id: str
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    rsu_id: str
    rsu_name: str
    advisory_type: V2IAdvisoryType = V2IAdvisoryType.FOG_WARNING
    title: str
    detail: str
    speed_limit_kmh: float | None = None
    expires_at_ms: int | None = None
    zone_x_m: float | None = None
    zone_y_m: float | None = None
    zone_radius_m: float | None = None


class V2XMessage(V2XModel):
    """Standardized V2X envelope for logging and transmission."""

    message_id: str
    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    msg_type: V2XMessageType
    source_id: str
    target_id: str = "BROADCAST"
    summary: str
    bsm_payload: V2VBasicSafetyMessage | None = None
    advisory_payload: V2IAdvisoryMessage | None = None


class V2XPeerNode(V2XModel):
    """Peer vehicle discovered on the V2V wireless mesh."""

    vehicle_id: str
    last_seen_ms: int = Field(default_factory=now_ms, ge=0)
    x_m: float
    y_m: float
    distance_m: float = Field(ge=0.0)
    speed_mps: float = Field(ge=0.0)
    heading_deg: float
    emergency_state: str = "SAFE"
    rssi_dbm: int = -55
    link_status: Literal["EXCELLENT", "GOOD", "DEGRADED", "LOST"] = "GOOD"


class V2XInfrastructureNode(V2XModel):
    """Roadside Unit (RSU) or base station discovered on the V2I channel."""

    rsu_id: str
    name: str
    x_m: float
    y_m: float
    status: Literal["ACTIVE", "STANDBY", "OFFLINE"] = "ACTIVE"
    coverage_radius_m: float = 150.0
    active_advisories_count: int = 0


class V2XState(V2XModel):
    """Unified V2X telemetry subsystem state."""

    timestamp_ms: int = Field(default_factory=now_ms, ge=0)
    enabled: bool = True
    node_id: str = "PRIMARY-DUMPER"
    protocol_version: str = "1.0-DSRC-SIM"
    tx_packet_count: int = 0
    rx_packet_count: int = 0
    channel_frequency_mhz: int = 5890
    active_peers: list[V2XPeerNode] = Field(default_factory=list)
    infrastructure_nodes: list[V2XInfrastructureNode] = Field(default_factory=list)
    active_advisories: list[V2IAdvisoryMessage] = Field(default_factory=list)
    recent_messages: list[V2XMessage] = Field(default_factory=list)
