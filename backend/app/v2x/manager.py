from __future__ import annotations

import math
import threading
import uuid
from typing import Literal

from backend.app.models.telemetry import (
    CorridorState,
    EmergencyLevel,
    EmergencyState,
    SafeCorridor,
    VehiclePose,
    now_ms,
)
from backend.app.models.v2x import (
    V2IAdvisoryMessage,
    V2IAdvisoryType,
    V2InfrastructureNode,
    V2VBasicSafetyMessage,
    V2XInfrastructureNode,
    V2XMessage,
    V2XMessageType,
    V2XPeerNode,
    V2XState,
)


class V2XManager:
    """Manages Vehicle-to-Vehicle (V2V) and Vehicle-to-Infrastructure (V2I) communication.

    Handles continuous BSM broadcast, peer distance computation, proximity hazard
    detection, roadside advisory dispatch, and message logging.
    """

    def __init__(
        self,
        node_id: str = "DUMPER_01",
        *,
        max_log_size: int = 50,
        peer_stale_ms: int = 5_000,
    ) -> None:
        self.node_id = node_id
        self._max_log_size = max_log_size
        self._peer_stale_ms = peer_stale_ms
        self._lock = threading.Lock()
        self._tx_count = 0
        self._rx_count = 0
        self._last_bsm_broadcast_ms = 0
        self._bsm_interval_ms = 500  # 2 Hz broadcast

        # Discovered peers and infrastructure units
        self._peers: dict[str, V2XPeerNode] = {}
        self._rsus: dict[str, V2XInfrastructureNode] = {}
        self._advisories: list[V2IAdvisoryMessage] = []
        self._message_log: list[V2XMessage] = []

        self._seed_default_infrastructure()
        self._seed_default_peers()

    def _seed_default_infrastructure(self) -> None:
        """Seed default mine Roadside Units (RSUs)."""
        rsu_north = V2XInfrastructureNode(
            rsu_id="RSU_MINE_PIT_NORTH",
            name="North Pit Haul RSU-1",
            x_m=20.0,
            y_m=45.0,
            status="ACTIVE",
            coverage_radius_m=200.0,
            active_advisories_count=1,
        )
        rsu_central = V2XInfrastructureNode(
            rsu_id="RSU_INTERSECTION_02",
            name="Central Haul Intersection RSU-2",
            x_m=0.0,
            y_m=10.0,
            status="ACTIVE",
            coverage_radius_m=150.0,
            active_advisories_count=0,
        )
        self._rsus[rsu_north.rsu_id] = rsu_north
        self._rsus[rsu_central.rsu_id] = rsu_central

        # Add an initial haul road advisory
        initial_advisory = V2IAdvisoryMessage(
            message_id=f"ADV-{uuid.uuid4().hex[:8].upper()}",
            timestamp_ms=now_ms(),
            rsu_id=rsu_north.rsu_id,
            rsu_name=rsu_north.name,
            advisory_type=V2IAdvisoryType.FOG_WARNING,
            title="Dense Fog Warning - Section B",
            detail="Reduced visibility reported on North ramp. Max speed 20 km/h.",
            speed_limit_kmh=20.0,
            zone_x_m=20.0,
            zone_y_m=45.0,
            zone_radius_m=80.0,
        )
        self._advisories.append(initial_advisory)

    def _seed_default_peers(self) -> None:
        """Seed default peer vehicles on the haul network."""
        peer_02 = V2XPeerNode(
            vehicle_id="DUMPER_02",
            last_seen_ms=now_ms(),
            x_m=12.5,
            y_m=28.0,
            distance_m=32.0,
            speed_mps=3.2,
            heading_deg=85.0,
            emergency_state="SAFE",
            rssi_dbm=-62,
            link_status="GOOD",
        )
        peer_03 = V2XPeerNode(
            vehicle_id="HAULER_07",
            last_seen_ms=now_ms(),
            x_m=-18.0,
            y_m=65.0,
            distance_m=75.0,
            speed_mps=4.5,
            heading_deg=260.0,
            emergency_state="SAFE",
            rssi_dbm=-74,
            link_status="GOOD",
        )
        self._peers[peer_02.vehicle_id] = peer_02
        self._peers[peer_03.vehicle_id] = peer_03

    def _append_log(self, msg: V2XMessage) -> None:
        self._message_log.append(msg)
        if len(self._message_log) > self._max_log_size:
            self._message_log.pop(0)

    def update_from_vehicle(
        self,
        vehicle: VehiclePose,
        emergency: EmergencyState,
        corridor: SafeCorridor,
        nearest_obstacle_m: float | None = None,
    ) -> None:
        """Update V2X telemetry cycle with the current primary vehicle state."""
        current_ms = now_ms()
        with self._lock:
            # Update distance and link quality to peer vehicles
            for peer in self._peers.values():
                dx = peer.x_m - vehicle.x_m
                dy = peer.y_m - vehicle.y_m
                dist = math.hypot(dx, dy)
                peer.distance_m = round(dist, 1)

                # Link status and simulated RSSI based on distance
                if dist < 40.0:
                    peer.rssi_dbm = -50 - int(dist * 0.4)
                    peer.link_status = "EXCELLENT"
                elif dist < 100.0:
                    peer.rssi_dbm = -66 - int((dist - 40.0) * 0.3)
                    peer.link_status = "GOOD"
                elif dist < 180.0:
                    peer.rssi_dbm = -84 - int((dist - 100.0) * 0.2)
                    peer.link_status = "DEGRADED"
                else:
                    peer.link_status = "LOST"

                # Check for low-visibility peer proximity convergence
                if dist < 15.0 and dist > 0.1:
                    alert_msg = V2XMessage(
                        message_id=f"ALERT-{uuid.uuid4().hex[:8].upper()}",
                        timestamp_ms=current_ms,
                        msg_type=V2XMessageType.V2V_PROXIMITY_ALERT,
                        source_id=self.node_id,
                        target_id=peer.vehicle_id,
                        summary=f"Proximity alert: {peer.vehicle_id} is {peer.distance_m}m away",
                    )
                    self._append_log(alert_msg)

            # Broadcast periodic V2V Basic Safety Message (BSM)
            if current_ms - self._last_bsm_broadcast_ms >= self._bsm_interval_ms:
                self._last_bsm_broadcast_ms = current_ms
                self._tx_count += 1

                bsm = V2VBasicSafetyMessage(
                    message_id=f"BSM-{uuid.uuid4().hex[:8].upper()}",
                    timestamp_ms=current_ms,
                    vehicle_id=vehicle.vehicle_id,
                    x_m=round(vehicle.x_m, 2),
                    y_m=round(vehicle.y_m, 2),
                    heading_deg=round(vehicle.heading_deg, 1),
                    speed_mps=round(vehicle.speed_mps, 2),
                    emergency_state=emergency.state.value if hasattr(emergency.state, "value") else str(emergency.state),
                    corridor_state=corridor.state.value if hasattr(corridor.state, "value") else str(corridor.state),
                    nearest_obstacle_m=nearest_obstacle_m,
                    brake_applied=emergency.motor_cut or vehicle.speed_mps < 0.1,
                )

                v2x_msg = V2XMessage(
                    message_id=bsm.message_id,
                    timestamp_ms=current_ms,
                    msg_type=V2XMessageType.V2V_BSM,
                    source_id=vehicle.vehicle_id,
                    target_id="BROADCAST",
                    summary=f"BSM: pos=({bsm.x_m}, {bsm.y_m}) v={round(bsm.speed_mps * 3.6, 1)}km/h state={bsm.emergency_state}",
                    bsm_payload=bsm,
                )
                self._append_log(v2x_msg)

            self._prune_expired(current_ms)

    def receive_bsm(self, bsm: V2VBasicSafetyMessage) -> None:
        """Process an incoming BSM from another vehicle."""
        current_ms = now_ms()
        with self._lock:
            self._rx_count += 1
            peer = V2XPeerNode(
                vehicle_id=bsm.vehicle_id,
                last_seen_ms=current_ms,
                x_m=bsm.x_m,
                y_m=bsm.y_m,
                distance_m=0.0,
                speed_mps=bsm.speed_mps,
                heading_deg=bsm.heading_deg,
                emergency_state=bsm.emergency_state,
                rssi_dbm=-58,
                link_status="GOOD",
            )
            self._peers[bsm.vehicle_id] = peer

            v2x_msg = V2XMessage(
                message_id=bsm.message_id,
                timestamp_ms=current_ms,
                msg_type=V2XMessageType.V2V_BSM,
                source_id=bsm.vehicle_id,
                target_id="BROADCAST",
                summary=f"Rx BSM from {bsm.vehicle_id}: pos=({bsm.x_m}, {bsm.y_m}) state={bsm.emergency_state}",
                bsm_payload=bsm,
            )
            self._append_log(v2x_msg)

    def broadcast_advisory(self, advisory: V2IAdvisoryMessage) -> None:
        """Broadcast an infrastructure or supervisor advisory to all vehicles."""
        current_ms = now_ms()
        with self._lock:
            self._tx_count += 1
            self._advisories.insert(0, advisory)

            # Update corresponding RSU count
            if advisory.rsu_id in self._rsus:
                self._rsus[advisory.rsu_id].active_advisories_count += 1

            msg = V2XMessage(
                message_id=advisory.message_id,
                timestamp_ms=current_ms,
                msg_type=V2XMessageType.V2I_ADVISORY,
                source_id=advisory.rsu_id,
                target_id="BROADCAST",
                summary=f"V2I Advisory [{advisory.advisory_type.value}]: {advisory.title}",
                advisory_payload=advisory,
            )
            self._append_log(msg)

    def _prune_expired(self, current_ms: int) -> None:
        """Remove expired advisories and update stale peers."""
        self._advisories = [
            adv
            for adv in self._advisories
            if adv.expires_at_ms is None or adv.expires_at_ms > current_ms
        ]
        for peer in self._peers.values():
            if current_ms - peer.last_seen_ms > self._peer_stale_ms:
                peer.link_status = "LOST"

    def snapshot(self) -> V2XState:
        """Return an immutable snapshot of current V2X state."""
        with self._lock:
            return V2XState(
                timestamp_ms=now_ms(),
                enabled=True,
                node_id=self.node_id,
                tx_packet_count=self._tx_count,
                rx_packet_count=self._rx_count,
                channel_frequency_mhz=5890,
                active_peers=list(self._peers.values()),
                infrastructure_nodes=list(self._rsus.values()),
                active_advisories=list(self._advisories),
                recent_messages=list(self._message_log),
            )
