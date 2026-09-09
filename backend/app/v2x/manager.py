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
    V2VBasicSafetyMessage,
    V2XInfrastructureNode,
    V2XMessage,
    V2XMessageType,
    V2XPeerNode,
    V2XState,
)


class V2XManager:
    """Manages Vehicle-to-Vehicle (V2V) and Vehicle-to-Infrastructure (V2I) communication.

    Handles continuous BSM broadcast, peer distance & bearing computation, proximity hazard
    detection with cooldown rate limiting, roadside advisory dispatch, RSU synchronization,
    and thread-safe immutable snapshot generation.
    """

    def __init__(
        self,
        node_id: str = "DUMPER_01",
        *,
        max_log_size: int = 50,
        peer_stale_ms: int = 5_000,
        bsm_interval_ms: int = 500,
        proximity_alert_cooldown_ms: int = 4_000,
        seed_demo: bool = True,
    ) -> None:
        self.node_id = node_id
        self._seed_demo = seed_demo
        self._max_log_size = max_log_size
        self._peer_stale_ms = peer_stale_ms
        self._bsm_interval_ms = bsm_interval_ms
        self._proximity_alert_cooldown_ms = proximity_alert_cooldown_ms
        self._lock = threading.Lock()
        self._enabled = True

        self._tx_count = 0
        self._rx_count = 0
        self._last_bsm_broadcast_ms = 0
        self._last_proximity_alert_ms: dict[str, int] = {}
        self._last_primary_pose: VehiclePose | None = None

        # Discovered peers and infrastructure units
        self._peers: dict[str, V2XPeerNode] = {}
        self._rsus: dict[str, V2XInfrastructureNode] = {}
        self._advisories: list[V2IAdvisoryMessage] = []
        self._message_log: list[V2XMessage] = []

        if self._seed_demo:
            self._seed_default_infrastructure()
            self._seed_default_peers()

    @property
    def enabled(self) -> bool:
        return self._enabled

    def clear_peers(self) -> None:
        """Replace seeded traffic when a simulator supplies its own vehicles."""
        with self._lock:
            self._peers.clear()
            self._last_proximity_alert_ms.clear()

    @enabled.setter
    def enabled(self, value: bool) -> None:
        with self._lock:
            self._enabled = bool(value)

    def reset(self) -> None:
        """Reset all dynamic V2X counters, logs, and reseed defaults."""
        with self._lock:
            self._tx_count = 0
            self._rx_count = 0
            self._last_bsm_broadcast_ms = 0
            self._last_proximity_alert_ms.clear()
            self._last_primary_pose = None
            self._peers.clear()
            self._rsus.clear()
            self._advisories.clear()
            self._message_log.clear()
            if self._seed_demo:
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
        current_time = now_ms()
        peer_02 = V2XPeerNode(
            vehicle_id="DUMPER_02",
            last_seen_ms=current_time,
            x_m=-43.0,
            y_m=38.0,
            distance_m=57.4,
            bearing_deg=311.5,
            speed_mps=3.2,
            heading_deg=270.0,
            emergency_state="SAFE",
            rssi_dbm=-71,
            link_status="GOOD",
        )
        peer_03 = V2XPeerNode(
            vehicle_id="HAULER_07",
            last_seen_ms=current_time,
            x_m=-18.0,
            y_m=65.0,
            distance_m=75.0,
            bearing_deg=345.0,
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

    @staticmethod
    def _compute_link_metrics(dist: float) -> tuple[int, Literal["EXCELLENT", "GOOD", "DEGRADED", "LOST"]]:
        """Compute realistic simulated RF RSSI (dBm) and link status from distance."""
        if dist < 40.0:
            rssi = -50 - int(dist * 0.4)
            status: Literal["EXCELLENT", "GOOD", "DEGRADED", "LOST"] = "EXCELLENT"
        elif dist < 100.0:
            rssi = -66 - int((dist - 40.0) * 0.3)
            status = "GOOD"
        elif dist < 180.0:
            rssi = -84 - int((dist - 100.0) * 0.2)
            status = "DEGRADED"
        else:
            rssi = -100
            status = "LOST"
        return max(-110, min(-40, rssi)), status

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
            if not self._enabled:
                return

            self._last_primary_pose = vehicle.model_copy(deep=True)

            # Update distance, bearing, and link quality to peer vehicles
            for peer in self._peers.values():
                dx = peer.x_m - vehicle.x_m
                dy = peer.y_m - vehicle.y_m
                dist = math.hypot(dx, dy)
                peer.distance_m = round(dist, 1)
                peer.bearing_deg = round(math.degrees(math.atan2(dx, dy)) % 360.0, 1)

                rssi, link_status = self._compute_link_metrics(dist)
                peer.rssi_dbm = rssi
                peer.link_status = link_status

                # Check for low-visibility peer proximity convergence with rate-limiting cooldown
                if 0.1 < dist < 15.0:
                    last_alert = self._last_proximity_alert_ms.get(peer.vehicle_id, 0)
                    if current_ms - last_alert >= self._proximity_alert_cooldown_ms:
                        self._last_proximity_alert_ms[peer.vehicle_id] = current_ms
                        alert_msg = V2XMessage(
                            message_id=f"ALERT-{uuid.uuid4().hex[:8].upper()}",
                            timestamp_ms=current_ms,
                            msg_type=V2XMessageType.V2V_PROXIMITY_ALERT,
                            source_id=self.node_id,
                            target_id=peer.vehicle_id,
                            summary=f"Proximity alert: {peer.vehicle_id} is {peer.distance_m}m away (bearing {peer.bearing_deg}°)",
                        )
                        self._append_log(alert_msg)
                elif dist >= 20.0 and peer.vehicle_id in self._last_proximity_alert_ms:
                    # Clear alert cooldown once vehicle moves safely away
                    self._last_proximity_alert_ms.pop(peer.vehicle_id, None)

            # Broadcast periodic V2V Basic Safety Message (BSM)
            if current_ms - self._last_bsm_broadcast_ms >= self._bsm_interval_ms:
                self._last_bsm_broadcast_ms = current_ms
                self._tx_count += 1

                emergency_str = (
                    emergency.state.value
                    if isinstance(emergency.state, EmergencyLevel)
                    else str(emergency.state)
                )
                corridor_str = (
                    corridor.state.value
                    if isinstance(corridor.state, CorridorState)
                    else str(corridor.state)
                )

                bsm = V2VBasicSafetyMessage(
                    message_id=f"BSM-{uuid.uuid4().hex[:8].upper()}",
                    timestamp_ms=current_ms,
                    vehicle_id=vehicle.vehicle_id,
                    x_m=round(vehicle.x_m, 2),
                    y_m=round(vehicle.y_m, 2),
                    heading_deg=round(vehicle.heading_deg % 360.0, 1),
                    speed_mps=round(max(0.0, vehicle.speed_mps), 2),
                    emergency_state=emergency_str,
                    corridor_state=corridor_str,
                    nearest_obstacle_m=(
                        round(max(0.0, nearest_obstacle_m), 2)
                        if nearest_obstacle_m is not None
                        else None
                    ),
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

            # Compute relative distance and bearing if primary vehicle pose is available
            dist = 0.0
            bearing = 0.0
            rssi = -58
            link_status: Literal["EXCELLENT", "GOOD", "DEGRADED", "LOST"] = "GOOD"

            if self._last_primary_pose is not None:
                dx = bsm.x_m - self._last_primary_pose.x_m
                dy = bsm.y_m - self._last_primary_pose.y_m
                dist = round(math.hypot(dx, dy), 1)
                bearing = round(math.degrees(math.atan2(dx, dy)) % 360.0, 1)
                rssi, link_status = self._compute_link_metrics(dist)

            peer = V2XPeerNode(
                vehicle_id=bsm.vehicle_id,
                last_seen_ms=current_ms,
                x_m=bsm.x_m,
                y_m=bsm.y_m,
                distance_m=dist,
                bearing_deg=bearing,
                speed_mps=bsm.speed_mps,
                heading_deg=bsm.heading_deg,
                emergency_state=bsm.emergency_state,
                rssi_dbm=rssi,
                link_status=link_status,
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

            # Sync RSU advisory counts
            self._sync_rsu_advisory_counts()

            adv_type_str = (
                advisory.advisory_type.value
                if isinstance(advisory.advisory_type, V2IAdvisoryType)
                else str(advisory.advisory_type)
            )

            msg = V2XMessage(
                message_id=advisory.message_id,
                timestamp_ms=current_ms,
                msg_type=V2XMessageType.V2I_ADVISORY,
                source_id=advisory.rsu_id,
                target_id="BROADCAST",
                summary=f"V2I Advisory [{adv_type_str}]: {advisory.title}",
                advisory_payload=advisory,
            )
            self._append_log(msg)

    def _sync_rsu_advisory_counts(self) -> None:
        """Keep RSU active_advisories_count synchronized with active advisories list."""
        rsu_counts: dict[str, int] = {}
        for adv in self._advisories:
            rsu_counts[adv.rsu_id] = rsu_counts.get(adv.rsu_id, 0) + 1
        for rsu_id, rsu in self._rsus.items():
            rsu.active_advisories_count = rsu_counts.get(rsu_id, 0)

    def _prune_expired(self, current_ms: int) -> None:
        """Remove expired advisories and update stale peers."""
        initial_len = len(self._advisories)
        self._advisories = [
            adv
            for adv in self._advisories
            if adv.expires_at_ms is None or adv.expires_at_ms > current_ms
        ]
        if len(self._advisories) != initial_len:
            self._sync_rsu_advisory_counts()

        for peer in self._peers.values():
            if current_ms - peer.last_seen_ms > self._peer_stale_ms:
                peer.link_status = "LOST"

    def snapshot(self) -> V2XState:
        """Return an immutable snapshot of current V2X state."""
        with self._lock:
            return V2XState(
                timestamp_ms=now_ms(),
                enabled=self._enabled,
                node_id=self.node_id,
                tx_packet_count=self._tx_count,
                rx_packet_count=self._rx_count,
                channel_frequency_mhz=5890,
                active_peers=[p.model_copy() for p in self._peers.values()],
                infrastructure_nodes=[r.model_copy() for r in self._rsus.values()],
                active_advisories=[a.model_copy() for a in self._advisories],
                recent_messages=[m.model_copy() for m in self._message_log],
            )
