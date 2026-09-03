from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.mine_map.graph import MineRoadGraph
from backend.app.mine_map.models import RoadStatus
from backend.app.navigation.models import RouteRequest
from backend.app.navigation.router import RouteOptimizer


def test_payload_aware_routing_loaded_vs_empty() -> None:
    graph = MineRoadGraph()
    router = RouteOptimizer(graph)

    # Empty Dumper (0T payload)
    empty_req = RouteRequest(
        start_node_id="PICKUP_NORTH_BENCH",
        end_node_id="DUMP_PRIMARY_CRUSHER",
        payload_tonnes=0.0,
        vehicle_id="DUMPER_EMPTY",
    )
    empty_route = router.find_route(empty_req)
    assert empty_route is not None
    assert "WP_RAMP_01" in empty_route.path_nodes
    assert "WP_RAMP_02" not in empty_route.path_nodes

    # Loaded Dumper (100T ore payload)
    loaded_req = RouteRequest(
        start_node_id="PICKUP_NORTH_BENCH",
        end_node_id="DUMP_PRIMARY_CRUSHER",
        payload_tonnes=100.0,
        vehicle_id="DUMPER_LOADED",
    )
    loaded_route = router.find_route(loaded_req)
    assert loaded_route is not None
    assert "WP_RAMP_02" in loaded_route.path_nodes
    assert "WP_RAMP_01" not in loaded_route.path_nodes

    # Loaded route has gentler gradient
    assert loaded_route.max_gradient_pct < empty_route.max_gradient_pct


def test_dynamic_rerouting_on_closed_edge() -> None:
    graph = MineRoadGraph()
    router = RouteOptimizer(graph)

    # Initial route for empty dumper uses steep ramp
    initial_route = router.find_route(RouteRequest(
        start_node_id="PICKUP_NORTH_BENCH",
        end_node_id="DUMP_PRIMARY_CRUSHER",
        payload_tonnes=0.0,
    ))
    assert initial_route is not None
    assert "WP_RAMP_01" in initial_route.path_nodes

    # Close the steep ramp edge
    graph.update_edge_status("E_STEEP_RAMP_A", RoadStatus.CLOSED)

    # Dynamic reroute check from J_HAUL_05
    advisory = router.check_dynamic_reroute(
        current_route=initial_route,
        closed_edge_id="E_STEEP_RAMP_A",
        current_node_id="J_HAUL_05",
        reason="Fallen boulder detected on steep ramp",
    )
    assert advisory is not None
    assert advisory.alternate_found is True
    # Alternate route now uses WP_RAMP_02 (gentle bypass)
    assert "WP_RAMP_02" in advisory.new_route.path_nodes
    assert "WP_RAMP_01" not in advisory.new_route.path_nodes


def test_navigation_api_route_endpoint() -> None:
    app = create_app()
    with TestClient(app) as client:
        # Route for 100T loaded dumper
        res = client.post(
            "/api/navigation/route",
            json={
                "start_node_id": "PICKUP_NORTH_BENCH",
                "end_node_id": "DUMP_PRIMARY_CRUSHER",
                "payload_tonnes": 100.0,
                "tare_weight_tonnes": 85.0,
                "vehicle_id": "DUMPER_01",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["vehicle_id"] == "DUMPER_01"
        assert data["payload_tonnes"] == 100.0
        assert "WP_RAMP_02" in data["path_nodes"]
        assert len(data["instructions"]) > 0
        assert data["total_distance_m"] > 0

        # Guidance endpoint
        res_g = client.get("/api/navigation/guidance?vehicle_id=DUMPER_01")
        assert res_g.status_code == 200
        g_data = res_g.json()
        assert g_data["vehicle_id"] == "DUMPER_01"
        assert "threat_level" in g_data
        assert "visibility_state" in g_data

        # Unknown vehicle returns 404
        res_unknown = client.get("/api/navigation/guidance?vehicle_id=NONEXISTENT_VEHICLE")
        assert res_unknown.status_code == 404
