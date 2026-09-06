from __future__ import annotations

import concurrent.futures
import math
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import PROJECT_ROOT, RuntimeSettings
from backend.app.main import create_app
from backend.app.models import (
    CorridorState,
    DataMode,
    EmergencyLevel,
    EmergencyState,
    SafeCorridor,
    V2IAdvisoryMessage,
    V2IAdvisoryType,
    V2VBasicSafetyMessage,
    V2XInfrastructureNode,
    V2XMessage,
    V2XMessageType,
    V2XPeerNode,
    V2XState,
    VehiclePose,
    WorldState,
)
from backend.app.v2x.manager import V2XManager


def test_v2x_models_validation_and_serialization() -> None:
    # Valid BSM
    bsm = V2VBasicSafetyMessage(
        message_id="BSM-TEST-01",
        vehicle_id="DUMPER_02",
        x_m=10.5,
        y_m=20.0,
        heading_deg=45.0,
        speed_mps=5.0,
        emergency_state="SAFE",
        corridor_state="GREEN",
        nearest_obstacle_m=12.5,
        brake_applied=False,
    )
    assert bsm.vehicle_id == "DUMPER_02"
    assert bsm.speed_mps == 5.0
    bsm_json = bsm.model_dump_json()
    assert "BSM-TEST-01" in bsm_json

    # Negative speed rejected
    with pytest.raises(ValidationError):
        V2VBasicSafetyMessage(
            message_id="BSM-ERR",
            vehicle_id="DUMPER_02",
            x_m=0.0,
            y_m=0.0,
            speed_mps=-1.0,
        )

    # Extra fields rejected by forbid
    with pytest.raises(ValidationError):
        V2VBasicSafetyMessage(
            message_id="BSM-EXTRA",
            vehicle_id="DUMPER_02",
            x_m=0.0,
            y_m=0.0,
            speed_mps=1.0,
            unknown_field=123,  # type: ignore[call-arg]
        )

    # Advisory model validation
    advisory = V2IAdvisoryMessage(
        message_id="ADV-TEST-01",
        rsu_id="RSU_NORTH",
        rsu_name="North Pit RSU",
        advisory_type=V2IAdvisoryType.FOG_WARNING,
        title="Dense Fog Warning",
        detail="Speed limited to 15 km/h",
        speed_limit_kmh=15.0,
        zone_x_m=20.0,
        zone_y_m=40.0,
        zone_radius_m=50.0,
    )
    assert advisory.advisory_type == V2IAdvisoryType.FOG_WARNING
    assert advisory.speed_limit_kmh == 15.0


def test_v2x_embedded_in_world_state() -> None:
    world = WorldState()
    assert world.v2x.enabled is True
    assert world.v2x.node_id == "PRIMARY-DUMPER"
    assert isinstance(world.v2x.active_peers, list)

    serialized = world.model_dump_json()
    assert '"v2x"' in serialized
    deserialized = WorldState.model_validate_json(serialized)
    assert deserialized.v2x.node_id == "PRIMARY-DUMPER"


def test_v2x_manager_peer_distance_and_bearing_calculation() -> None:
    mgr = V2XManager(node_id="DUMPER_01")
    mgr.reset()

    # Primary vehicle at (0, 0) facing North (heading 0°)
    primary = VehiclePose(x_m=0.0, y_m=0.0, heading_deg=0.0, speed_mps=2.0)
    emergency = EmergencyState(state=EmergencyLevel.SAFE)
    corridor = SafeCorridor(state=CorridorState.GREEN)

    # DUMPER_02 is on the west campus road, separate from the primary route.
    mgr.update_from_vehicle(primary, emergency, corridor)
    snap = mgr.snapshot()

    peer_map = {p.vehicle_id: p for p in snap.active_peers}
    assert "DUMPER_02" in peer_map
    peer_02 = peer_map["DUMPER_02"]

    expected_dist = round(math.hypot(-43.0, 38.0), 1)
    assert peer_02.distance_m == expected_dist
    assert 0.0 < peer_02.distance_m < 100.0
    expected_bearing = round(math.degrees(math.atan2(-43.0, 38.0)) % 360.0, 1)
    assert peer_02.bearing_deg == expected_bearing
    assert peer_02.link_status == "GOOD"


def test_v2x_manager_proximity_alert_and_rate_limiting() -> None:
    mgr = V2XManager(node_id="DUMPER_01", proximity_alert_cooldown_ms=3000)
    mgr.reset()

    primary = VehiclePose(x_m=0.0, y_m=0.0, heading_deg=0.0, speed_mps=1.0)
    emergency = EmergencyState(state=EmergencyLevel.SAFE)
    corridor = SafeCorridor(state=CorridorState.GREEN)

    # Send BSM putting peer nearby at (5.0, 5.0) -> distance ~ 7.07m (< 15m)
    close_bsm = V2VBasicSafetyMessage(
        message_id="BSM-CLOSE-01",
        vehicle_id="DUMPER_NEAR",
        x_m=5.0,
        y_m=5.0,
        speed_mps=1.5,
    )
    mgr.receive_bsm(close_bsm)

    # First update triggers proximity alert
    mgr.update_from_vehicle(primary, emergency, corridor)
    snap1 = mgr.snapshot()
    alert_msgs_1 = [
        m for m in snap1.recent_messages if m.msg_type == V2XMessageType.V2V_PROXIMITY_ALERT
    ]
    assert len(alert_msgs_1) == 1
    assert alert_msgs_1[0].target_id == "DUMPER_NEAR"

    # Immediate second update within cooldown should NOT produce another alert
    mgr.update_from_vehicle(primary, emergency, corridor)
    snap2 = mgr.snapshot()
    alert_msgs_2 = [
        m for m in snap2.recent_messages if m.msg_type == V2XMessageType.V2V_PROXIMITY_ALERT
    ]
    assert len(alert_msgs_2) == 1  # Still only 1 alert


def test_v2x_advisory_broadcast_and_rsu_sync() -> None:
    mgr = V2XManager(node_id="DUMPER_01")
    mgr.reset()

    snap_init = mgr.snapshot()
    rsu_north_init = next(r for r in snap_init.infrastructure_nodes if r.rsu_id == "RSU_MINE_PIT_NORTH")
    initial_adv_count = rsu_north_init.active_advisories_count

    # Broadcast new advisory for North RSU
    adv = V2IAdvisoryMessage(
        message_id="ADV-TEST-SPEED",
        rsu_id="RSU_MINE_PIT_NORTH",
        rsu_name="North Pit Haul RSU-1",
        advisory_type=V2IAdvisoryType.SPEED_RESTRICTION,
        title="Speed Limit 15 km/h",
        detail="Haul road maintenance",
        speed_limit_kmh=15.0,
        expires_at_ms=int(time.time() * 1000) + 60000,
    )
    mgr.broadcast_advisory(adv)

    snap = mgr.snapshot()
    assert snap.tx_packet_count >= 1
    rsu_north = next(r for r in snap.infrastructure_nodes if r.rsu_id == "RSU_MINE_PIT_NORTH")
    assert rsu_north.active_advisories_count == initial_adv_count + 1
    assert any(a.message_id == "ADV-TEST-SPEED" for a in snap.active_advisories)


def test_v2x_advisory_expiration_pruning() -> None:
    mgr = V2XManager(node_id="DUMPER_01")
    mgr.reset()

    past_ms = int(time.time() * 1000) - 5000
    expired_adv = V2IAdvisoryMessage(
        message_id="ADV-EXPIRED",
        rsu_id="RSU_INTERSECTION_02",
        rsu_name="Central Haul Intersection RSU-2",
        advisory_type=V2IAdvisoryType.HAZARD_ZONE,
        title="Temporary Obstruction",
        detail="Temporary berm work",
        expires_at_ms=past_ms,
    )
    mgr.broadcast_advisory(expired_adv)

    primary = VehiclePose(x_m=0.0, y_m=0.0, heading_deg=0.0, speed_mps=1.0)
    emergency = EmergencyState(state=EmergencyLevel.SAFE)
    corridor = SafeCorridor(state=CorridorState.GREEN)

    # update_from_vehicle triggers _prune_expired
    mgr.update_from_vehicle(primary, emergency, corridor)
    snap = mgr.snapshot()

    assert not any(a.message_id == "ADV-EXPIRED" for a in snap.active_advisories)
    rsu_central = next(r for r in snap.infrastructure_nodes if r.rsu_id == "RSU_INTERSECTION_02")
    assert rsu_central.active_advisories_count == 0


def test_v2x_snapshot_immutability_and_thread_safety() -> None:
    mgr = V2XManager(node_id="DUMPER_01")
    mgr.reset()

    snap1 = mgr.snapshot()
    if snap1.active_peers:
        # Mutate the returned snapshot object
        snap1.active_peers[0].distance_m = 9999.0

    snap2 = mgr.snapshot()
    # Internal manager state should remain untouched
    if snap2.active_peers:
        assert snap2.active_peers[0].distance_m != 9999.0

    # Test concurrent updates and snapshots
    def worker(i: int) -> None:
        pose = VehiclePose(x_m=float(i), y_m=float(i * 2), heading_deg=float(i % 360), speed_mps=2.0)
        emg = EmergencyState(state=EmergencyLevel.SAFE)
        cor = SafeCorridor(state=CorridorState.GREEN)
        mgr.update_from_vehicle(pose, emg, cor)
        _ = mgr.snapshot()
        mgr.receive_bsm(
            V2VBasicSafetyMessage(
                message_id=f"BSM-CONCUR-{i}",
                vehicle_id=f"VEH_{i}",
                x_m=float(i),
                y_m=float(i),
                speed_mps=1.0,
            )
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(worker, i) for i in range(40)]
        for f in futures:
            f.result()

    final_snap = mgr.snapshot()
    assert final_snap.rx_packet_count == 40


def test_v2x_api_endpoints() -> None:
    app = create_app(
        RuntimeSettings(config_dir=Path(PROJECT_ROOT / "config"), telemetry_hz=20)
    )
    with TestClient(app) as client:
        # GET /api/v2x/state
        res = client.get("/api/v2x/state")
        assert res.status_code == 200
        state = res.json()
        assert state["enabled"] is True
        assert state["node_id"] == "DUMPER_01"
        assert len(state["infrastructure_nodes"]) >= 2
        assert [peer["vehicle_id"] for peer in state["active_peers"]] == ["DUMPER_02"]

        # POST /api/v2x/messages/bsm
        bsm_payload = {
            "message_id": "BSM-REMOTE-99",
            "timestamp_ms": int(time.time() * 1000),
            "vehicle_id": "DUMPER_99",
            "x_m": 25.0,
            "y_m": 35.0,
            "heading_deg": 120.0,
            "speed_mps": 4.0,
            "emergency_state": "SAFE",
            "corridor_state": "GREEN",
            "nearest_obstacle_m": None,
            "brake_applied": False,
        }
        post_res = client.post("/api/v2x/messages/bsm", json=bsm_payload)
        assert post_res.status_code == 200
        assert post_res.json()["status"] == "accepted"
        assert post_res.json()["message_id"] == "BSM-REMOTE-99"

        # Verify peer is now visible in state
        updated_state = client.get("/api/v2x/state").json()
        peer_ids = [p["vehicle_id"] for p in updated_state["active_peers"]]
        assert "DUMPER_99" in peer_ids

        # POST /api/v2x/broadcast-advisory
        adv_payload = {
            "message_id": "ADV-DISPATCH-01",
            "timestamp_ms": int(time.time() * 1000),
            "rsu_id": "RSU_MINE_PIT_NORTH",
            "rsu_name": "North Pit Haul RSU-1",
            "advisory_type": "PASSAGE_PRIORITY",
            "title": "Loaded Hauler Priority",
            "detail": "Yield to uphill haulers",
            "speed_limit_kmh": None,
        }
        adv_res = client.post("/api/v2x/broadcast-advisory", json=adv_payload)
        assert adv_res.status_code == 200
        assert adv_res.json()["status"] == "broadcasted"

        # Check in state
        new_state = client.get("/api/v2x/state").json()
        assert any(a["message_id"] == "ADV-DISPATCH-01" for a in new_state["active_advisories"])

        # Invalid BSM payload returns 422
        bad_bsm = {"message_id": "BSM-BAD", "speed_mps": -5.0}
        assert client.post("/api/v2x/messages/bsm", json=bad_bsm).status_code == 422


def test_v2x_simulation_runtime_integration() -> None:
    app = create_app(
        RuntimeSettings(config_dir=Path(PROJECT_ROOT / "config"), telemetry_hz=20)
    )
    with TestClient(app) as client:
        # Tick the simulation
        control = client.post(
            "/api/simulation/control",
            json={"running": True, "speed_scale": 1.0},
        )
        assert control.status_code == 200

        # World snapshot should contain live V2X telemetry
        world = client.get("/api/world").json()
        assert "v2x" in world
        v2x = world["v2x"]
        assert v2x["enabled"] is True
        assert v2x["tx_packet_count"] >= 1
        assert {peer["vehicle_id"] for peer in v2x["active_peers"]} == {
            vehicle["vehicle_id"] for vehicle in world["vehicles"]
            if vehicle["vehicle_id"] != world["primary_vehicle_id"]
        }
        assert len(v2x["recent_messages"]) >= 1
