from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.mine_map.graph import MineRoadGraph, build_default_bailadila_network
from backend.app.mine_map.models import NodeType, RoadStatus


def test_mine_network_topology() -> None:
    graph = MineRoadGraph()
    network = graph.network

    # Check benches and dumps
    assert "PICKUP_NORTH_BENCH" in network.nodes
    assert network.nodes["PICKUP_NORTH_BENCH"].node_type == NodeType.BENCH
    assert "PICKUP_EAST_PIT" in network.nodes
    assert network.nodes["PICKUP_EAST_PIT"].node_type == NodeType.BENCH
    assert "DUMP_PRIMARY_CRUSHER" in network.nodes
    assert network.nodes["DUMP_PRIMARY_CRUSHER"].node_type == NodeType.DUMP
    assert "DUMP_WASTE_SOUTH" in network.nodes
    assert network.nodes["DUMP_WASTE_SOUTH"].node_type == NodeType.DUMP

    # Check junctions J_HAUL_01 to J_HAUL_08
    for i in range(1, 9):
        jid = f"J_HAUL_{i:02d}"
        assert jid in network.nodes
        assert network.nodes[jid].node_type == NodeType.JUNCTION

    # Check key waypoints
    assert "WP_RAMP_01" in network.nodes
    assert "WP_RAMP_02" in network.nodes
    assert "WP_CRUSHER_ACCESS" in network.nodes

    # Check edges
    assert len(network.edges) >= 14
    for edge in network.edges.values():
        assert edge.distance_m > 0
        assert edge.max_weight_tonnes >= 200.0
        assert edge.road_status == RoadStatus.OPEN


def test_mine_edge_status_update() -> None:
    graph = MineRoadGraph()
    edge_id = "E_STEEP_RAMP_A"

    # Update to RESTRICTED
    updated = graph.update_edge_status(edge_id, RoadStatus.RESTRICTED, risk_penalty=25.0, speed_limit_kmh=15.0)
    assert updated is not None
    assert updated.road_status == RoadStatus.RESTRICTED
    assert updated.risk_penalty == 25.0
    assert updated.speed_limit_kmh == 15.0

    # Update to CLOSED
    closed = graph.update_edge_status(edge_id, RoadStatus.CLOSED)
    assert closed is not None
    assert closed.road_status == RoadStatus.CLOSED


def test_mine_to_reference_map_conversion() -> None:
    graph = MineRoadGraph()
    ref_map = graph.to_reference_map("TEST_MINE_MAP")
    assert ref_map.map_id == "TEST_MINE_MAP"
    assert len(ref_map.features) > 0

    road_features = [f for f in ref_map.features if f.feature_type.value == "ROAD"]
    centerline_features = [f for f in ref_map.features if f.feature_type.value == "CENTERLINE"]
    assert len(road_features) > 0
    assert len(centerline_features) > 0


def test_mine_network_endpoints() -> None:
    app = create_app()
    with TestClient(app) as client:
        # GET /api/mine/network
        res = client.get("/api/mine/network")
        assert res.status_code == 200
        data = res.json()
        assert "nodes" in data
        assert "edges" in data
        assert "PICKUP_NORTH_BENCH" in data["nodes"]
        assert "DUMP_PRIMARY_CRUSHER" in data["nodes"]

        # POST /api/mine/edges/{edge_id}/status
        res_post = client.post(
            "/api/mine/edges/E_STEEP_RAMP_A/status",
            json={
                "status": "RESTRICTED",
                "risk_penalty": 20.0,
                "speed_limit_kmh": 15.0,
                "reason": "Heavy fog speed restriction",
            },
        )
        assert res_post.status_code == 200
        edge_data = res_post.json()
        assert edge_data["road_status"] == "RESTRICTED"
        assert edge_data["risk_penalty"] == 20.0
        assert edge_data["speed_limit_kmh"] == 15.0
