from __future__ import annotations

import math
from typing import Any

from backend.app.mine_map.models import (
    MineEdge,
    MineNetwork,
    MineNode,
    NodeType,
    RoadStatus,
)
from backend.app.models.telemetry import (
    GeometryType,
    MapFeature,
    MapFeatureType,
    Point2D,
    ReferenceMap,
)


class MineRoadGraph:
    """Directed graph representation of NMDC Bailadila Deposit 5 / Deposit 14 open-cast mine."""

    def __init__(self, network: MineNetwork | None = None) -> None:
        if network is None:
            self._network = build_default_bailadila_network()
        else:
            self._network = network
        self._adjacency: dict[str, list[MineEdge]] = {}
        self._rebuild_adjacency()

    @property
    def network(self) -> MineNetwork:
        return self._network

    @property
    def nodes(self) -> dict[str, MineNode]:
        return self._network.nodes

    @property
    def edges(self) -> dict[str, MineEdge]:
        return self._network.edges

    def _rebuild_adjacency(self) -> None:
        self._adjacency = {node_id: [] for node_id in self._network.nodes}
        for edge in self._network.edges.values():
            if edge.from_node in self._adjacency:
                self._adjacency[edge.from_node].append(edge)
            # Bidirectional edges also add reverse directed edge if not already present
            if edge.is_bidirectional:
                reverse_edge = MineEdge(
                    edge_id=f"{edge.edge_id}_REV",
                    from_node=edge.to_node,
                    to_node=edge.from_node,
                    distance_m=edge.distance_m,
                    gradient_pct=-edge.gradient_pct,
                    max_weight_tonnes=edge.max_weight_tonnes,
                    road_status=edge.road_status,
                    speed_limit_kmh=edge.speed_limit_kmh,
                    risk_penalty=edge.risk_penalty,
                    lanes=edge.lanes,
                    is_bidirectional=True,
                    surface=edge.surface,
                    segment_name=edge.segment_name,
                )
                if edge.to_node in self._adjacency:
                    self._adjacency[edge.to_node].append(reverse_edge)

    def get_node(self, node_id: str) -> MineNode | None:
        return self._network.nodes.get(node_id)

    def get_edge(self, edge_id: str) -> MineEdge | None:
        # Check original edge
        if edge_id in self._network.edges:
            return self._network.edges[edge_id]
        # Check reverse edge name
        base_id = edge_id.removesuffix("_REV")
        if base_id in self._network.edges:
            base_edge = self._network.edges[base_id]
            return MineEdge(
                edge_id=edge_id,
                from_node=base_edge.to_node,
                to_node=base_edge.from_node,
                distance_m=base_edge.distance_m,
                gradient_pct=-base_edge.gradient_pct,
                max_weight_tonnes=base_edge.max_weight_tonnes,
                road_status=base_edge.road_status,
                speed_limit_kmh=base_edge.speed_limit_kmh,
                risk_penalty=base_edge.risk_penalty,
                lanes=base_edge.lanes,
                is_bidirectional=True,
                surface=base_edge.surface,
                segment_name=base_edge.segment_name,
            )
        return None

    def get_outgoing_edges(self, node_id: str) -> list[MineEdge]:
        return list(self._adjacency.get(node_id, []))

    def update_edge_status(
        self,
        edge_id: str,
        status: RoadStatus,
        risk_penalty: float | None = None,
        speed_limit_kmh: float | None = None,
    ) -> MineEdge | None:
        base_id = edge_id.removesuffix("_REV")
        if base_id not in self._network.edges:
            return None
        edge = self._network.edges[base_id]
        updated = edge.model_copy(
            update={
                "road_status": status,
                **({"risk_penalty": risk_penalty} if risk_penalty is not None else {}),
                **({"speed_limit_kmh": speed_limit_kmh} if speed_limit_kmh is not None else {}),
            }
        )
        self._network.edges[base_id] = updated
        self._rebuild_adjacency()
        return updated

    def to_reference_map(self, map_id: str = "NMDC_BAILADILA_DEP_05") -> ReferenceMap:
        """Convert mine road network to ReferenceMap for safe-corridor and visual rendering."""
        features: list[MapFeature] = []

        # Create road polygons and centerline polylines from edges
        for edge_id, edge in self._network.edges.items():
            fn = self.get_node(edge.from_node)
            tn = self.get_node(edge.to_node)
            if not fn or not tn:
                continue

            dx = tn.x_m - fn.x_m
            dy = tn.y_m - fn.y_m
            dist = math.hypot(dx, dy)
            if dist < 0.001:
                continue

            # Perpendicular vector for road width
            half_width = 4.5 if edge.lanes >= 2 else 3.2
            nx = -dy / dist * half_width
            ny = dx / dist * half_width

            # Road polygon
            poly_points = [
                Point2D(x_m=round(fn.x_m + nx, 2), y_m=round(fn.y_m + ny, 2)),
                Point2D(x_m=round(tn.x_m + nx, 2), y_m=round(tn.y_m + ny, 2)),
                Point2D(x_m=round(tn.x_m - nx, 2), y_m=round(tn.y_m - ny, 2)),
                Point2D(x_m=round(fn.x_m - nx, 2), y_m=round(fn.y_m - ny, 2)),
            ]
            features.append(
                MapFeature(
                    feature_id=f"road-{edge_id}",
                    feature_type=MapFeatureType.ROAD,
                    geometry_type=GeometryType.POLYGON,
                    label=edge.segment_name or f"Segment {edge_id}",
                    properties={
                        "edge_id": edge_id,
                        "status": edge.road_status.value,
                        "gradient_pct": edge.gradient_pct,
                        "lanes": edge.lanes,
                    },
                    points=poly_points,
                )
            )

            # Centerline
            features.append(
                MapFeature(
                    feature_id=f"centerline-{edge_id}",
                    feature_type=MapFeatureType.CENTERLINE,
                    geometry_type=GeometryType.POLYLINE,
                    label=f"Centerline {edge_id}",
                    properties={"edge_id": edge_id},
                    points=[
                        Point2D(x_m=fn.x_m, y_m=fn.y_m),
                        Point2D(x_m=tn.x_m, y_m=tn.y_m),
                    ],
                )
            )

        # Add node markers (benches, dumps, junctions)
        for node_id, node in self._network.nodes.items():
            feat_type = (
                MapFeatureType.START
                if node.node_type == NodeType.BENCH
                else MapFeatureType.DESTINATION
                if node.node_type == NodeType.DUMP
                else MapFeatureType.INTERSECTION
            )
            features.append(
                MapFeature(
                    feature_id=f"node-{node_id}",
                    feature_type=feat_type,
                    geometry_type=GeometryType.POINT,
                    label=node.name,
                    properties={
                        "node_id": node_id,
                        "node_type": node.node_type.value,
                        "elevation_m": node.elevation_m,
                    },
                    points=[Point2D(x_m=node.x_m, y_m=node.y_m)],
                )
            )

        # Default canonical route through the network from North Bench to Primary Crusher
        default_route_points = [
            Point2D(x_m=15.0, y_m=105.0),  # PICKUP_NORTH_BENCH
            Point2D(x_m=30.0, y_m=95.0),   # J_HAUL_05
            Point2D(x_m=25.0, y_m=70.0),   # J_HAUL_03
            Point2D(x_m=10.0, y_m=45.0),   # WP_RAMP_01
            Point2D(x_m=20.0, y_m=18.0),   # J_HAUL_01
            Point2D(x_m=10.0, y_m=10.0),   # WP_CRUSHER_ACCESS
            Point2D(x_m=5.0, y_m=5.0),     # DUMP_PRIMARY_CRUSHER
        ]
        features.append(
            MapFeature(
                feature_id="route-haul-main",
                feature_type=MapFeatureType.ROUTE,
                geometry_type=GeometryType.POLYLINE,
                label="Primary North-Crusher Haul Route",
                properties={"route_id": "MAIN_HAUL_CYCLE"},
                points=default_route_points,
            )
        )

        return ReferenceMap(
            map_id=map_id,
            name="NMDC Bailadila Deposit 5 Iron Ore Mine Road Network",
            version=1,
            coordinate_frame="LOCAL_CARTESIAN_METRES",
            source="SURVEYED",
            features=features,
        )


def build_default_bailadila_network() -> MineNetwork:
    """Build the NMDC Bailadila Deposit 5 / Deposit 14 inspired topology."""

    nodes: dict[str, MineNode] = {
        # Shovels & Benches (Extraction Zones at pit base)
        "PICKUP_NORTH_BENCH": MineNode(
            node_id="PICKUP_NORTH_BENCH",
            name="North Bench Shovel #04",
            x_m=15.0,
            y_m=105.0,
            elevation_m=550.0,
            node_type=NodeType.BENCH,
            description="Active iron ore extraction face bench at RL 550m",
        ),
        "PICKUP_EAST_PIT": MineNode(
            node_id="PICKUP_EAST_PIT",
            name="East Pit Shovel #02",
            x_m=140.0,
            y_m=35.0,
            elevation_m=540.0,
            node_type=NodeType.BENCH,
            description="Deep pit high-grade hematite face at RL 540m",
        ),

        # Dumps & Processing (Surface / Crest)
        "DUMP_PRIMARY_CRUSHER": MineNode(
            node_id="DUMP_PRIMARY_CRUSHER",
            name="Primary Gyratory Crusher #01",
            x_m=5.0,
            y_m=5.0,
            elevation_m=600.0,
            node_type=NodeType.DUMP,
            description="Gyratory crusher hopper bin RL 600m",
        ),
        "DUMP_WASTE_SOUTH": MineNode(
            node_id="DUMP_WASTE_SOUTH",
            name="South Overburden Waste Dump",
            x_m=110.0,
            y_m=-25.0,
            elevation_m=585.0,
            node_type=NodeType.DUMP,
            description="Overburden waste rock disposal terrace RL 585m",
        ),

        # Junctions
        "J_HAUL_01": MineNode(
            node_id="J_HAUL_01",
            name="Crusher Incline Junction",
            x_m=20.0,
            y_m=18.0,
            elevation_m=595.0,
            node_type=NodeType.JUNCTION,
            description="Junction connecting crusher access and main haul spine",
        ),
        "J_HAUL_02": MineNode(
            node_id="J_HAUL_02",
            name="Central Spine Split",
            x_m=45.0,
            y_m=32.0,
            elevation_m=588.0,
            node_type=NodeType.JUNCTION,
            description="Central intersection between North bench bypass and East pit",
        ),
        "J_HAUL_03": MineNode(
            node_id="J_HAUL_03",
            name="North Pit Switchback West",
            x_m=25.0,
            y_m=70.0,
            elevation_m=560.0,
            node_type=NodeType.JUNCTION,
            description="Steep ramp switchback junction",
        ),
        "J_HAUL_04": MineNode(
            node_id="J_HAUL_04",
            name="North Pit Switchback East",
            x_m=60.0,
            y_m=85.0,
            elevation_m=565.0,
            node_type=NodeType.JUNCTION,
            description="Gentle gradient bypass junction",
        ),
        "J_HAUL_05": MineNode(
            node_id="J_HAUL_05",
            name="North Bench Approach",
            x_m=30.0,
            y_m=95.0,
            elevation_m=555.0,
            node_type=NodeType.JUNCTION,
            description="Approach junction for North Bench shovel loading area",
        ),
        "J_HAUL_06": MineNode(
            node_id="J_HAUL_06",
            name="East Pit Divide",
            x_m=75.0,
            y_m=25.0,
            elevation_m=582.0,
            node_type=NodeType.JUNCTION,
            description="Haul split towards East Pit and South Waste Dump",
        ),
        "J_HAUL_07": MineNode(
            node_id="J_HAUL_07",
            name="East Pit Deep Ramp Junction",
            x_m=110.0,
            y_m=15.0,
            elevation_m=560.0,
            node_type=NodeType.JUNCTION,
            description="Incline junction descending into East Pit bottom",
        ),
        "J_HAUL_08": MineNode(
            node_id="J_HAUL_08",
            name="Waste Dump Access Junction",
            x_m=85.0,
            y_m=-10.0,
            elevation_m=585.0,
            node_type=NodeType.JUNCTION,
            description="Entry gate road for waste disposal area",
        ),

        # Waypoints for accurate geometric curvature & gradient profiles
        "WP_RAMP_01": MineNode(
            node_id="WP_RAMP_01",
            name="Steep Central Ramp #01",
            x_m=10.0,
            y_m=45.0,
            elevation_m=578.0,
            node_type=NodeType.WAYPOINT,
            description="Direct steep shortcut ramp (11.8% gradient)",
        ),
        "WP_RAMP_02": MineNode(
            node_id="WP_RAMP_02",
            name="Gentle Perimeter Bypass #02",
            x_m=45.0,
            y_m=60.0,
            elevation_m=576.0,
            node_type=NodeType.WAYPOINT,
            description="Gentle gradient perimeter haul road (4.2% gradient)",
        ),
        "WP_CRUSHER_ACCESS": MineNode(
            node_id="WP_CRUSHER_ACCESS",
            name="Crusher Approach Waypoint",
            x_m=10.0,
            y_m=10.0,
            elevation_m=598.0,
            node_type=NodeType.WAYPOINT,
            description="Crusher bin tipping access loop",
        ),
        "WP_EAST_PIT_APPROACH": MineNode(
            node_id="WP_EAST_PIT_APPROACH",
            name="East Pit Lower Waypoint",
            x_m=128.0,
            y_m=28.0,
            elevation_m=548.0,
            node_type=NodeType.WAYPOINT,
            description="East pit bench 2 approach segment",
        ),
        "WP_WASTE_APPROACH": MineNode(
            node_id="WP_WASTE_APPROACH",
            name="Waste Tip Crest Waypoint",
            x_m=98.0,
            y_m=-20.0,
            elevation_m=585.0,
            node_type=NodeType.WAYPOINT,
            description="Berm edge tipping ramp",
        ),
    }

    # Helper to compute distance and gradient between nodes
    def make_edge(
        edge_id: str,
        from_id: str,
        to_id: str,
        segment_name: str,
        speed_limit_kmh: float = 40.0,
        lanes: int = 2,
        is_bidirectional: bool = True,
        override_gradient_pct: float | None = None,
        risk_penalty: float = 0.0,
    ) -> MineEdge:
        fn = nodes[from_id]
        tn = nodes[to_id]
        dx = tn.x_m - fn.x_m
        dy = tn.y_m - fn.y_m
        horiz_dist = math.hypot(dx, dy)
        dh = tn.elevation_m - fn.elevation_m
        grad = round((dh / horiz_dist) * 100.0, 1) if horiz_dist > 0 else 0.0
        if override_gradient_pct is not None:
            grad = override_gradient_pct
        return MineEdge(
            edge_id=edge_id,
            from_node=from_id,
            to_node=to_id,
            distance_m=round(horiz_dist, 1),
            gradient_pct=grad,
            max_weight_tonnes=240.0,
            road_status=RoadStatus.OPEN,
            speed_limit_kmh=speed_limit_kmh,
            risk_penalty=risk_penalty,
            lanes=lanes,
            is_bidirectional=is_bidirectional,
            segment_name=segment_name,
        )

    edges: dict[str, MineEdge] = {
        # Crusher access
        "E_CRUSHER_01": make_edge(
            "E_CRUSHER_01", "DUMP_PRIMARY_CRUSHER", "WP_CRUSHER_ACCESS",
            "Crusher Bin Incline", speed_limit_kmh=20.0, lanes=2, override_gradient_pct=2.0
        ),
        "E_CRUSHER_02": make_edge(
            "E_CRUSHER_02", "WP_CRUSHER_ACCESS", "J_HAUL_01",
            "Crusher Access Loop", speed_limit_kmh=30.0, lanes=2, override_gradient_pct=2.5
        ),

        # Main Spine Segment 1 between J_HAUL_01 and J_HAUL_02 (gentle 3.5% grade)
        "E_SPINE_01": make_edge(
            "E_SPINE_01", "J_HAUL_01", "J_HAUL_02",
            "Main Haul Spine Segment 1", speed_limit_kmh=40.0, lanes=2,
            override_gradient_pct=-3.5
        ),

        # STEEP SHORTCUT ROUTE: J_HAUL_01 <-> WP_RAMP_01 <-> J_HAUL_03 (Steep 11.8% gradient shortcut)
        "E_STEEP_RAMP_A": make_edge(
            "E_STEEP_RAMP_A", "J_HAUL_01", "WP_RAMP_01",
            "Steep Ramp Upper (11.8% Grade)", speed_limit_kmh=25.0, lanes=1,
            override_gradient_pct=-11.8, risk_penalty=12.0
        ),
        "E_STEEP_RAMP_B": make_edge(
            "E_STEEP_RAMP_B", "WP_RAMP_01", "J_HAUL_03",
            "Steep Ramp Lower (11.8% Grade)", speed_limit_kmh=25.0, lanes=1,
            override_gradient_pct=-11.8, risk_penalty=12.0
        ),

        # GENTLE BYPASS ROUTE: J_HAUL_02 <-> WP_RAMP_02 <-> J_HAUL_04 (Gentle 4.2% gradient, dual lanes)
        "E_GENTLE_BYPASS_A": make_edge(
            "E_GENTLE_BYPASS_A", "J_HAUL_02", "WP_RAMP_02",
            "Gentle Bypass South (4.2% Grade)", speed_limit_kmh=35.0, lanes=2,
            override_gradient_pct=-4.2, risk_penalty=0.0
        ),
        "E_GENTLE_BYPASS_B": make_edge(
            "E_GENTLE_BYPASS_B", "WP_RAMP_02", "J_HAUL_04",
            "Gentle Bypass North (4.2% Grade)", speed_limit_kmh=35.0, lanes=2,
            override_gradient_pct=-4.2, risk_penalty=0.0
        ),

        # North Bench connections
        "E_NORTH_SWITCHBACK": make_edge(
            "E_NORTH_SWITCHBACK", "J_HAUL_03", "J_HAUL_05",
            "North West Switchback", speed_limit_kmh=30.0, lanes=2,
            override_gradient_pct=-2.5
        ),
        "E_NORTH_CONNECT": make_edge(
            "E_NORTH_CONNECT", "J_HAUL_04", "J_HAUL_05",
            "North East Bench Connector", speed_limit_kmh=30.0, lanes=2,
            override_gradient_pct=-3.0
        ),
        "E_NORTH_FACE": make_edge(
            "E_NORTH_FACE", "J_HAUL_05", "PICKUP_NORTH_BENCH",
            "North Bench Face Haul", speed_limit_kmh=25.0, lanes=2,
            override_gradient_pct=-2.0
        ),

        # Cross-cut between switchback junctions
        "E_CROSS_03_04": make_edge(
            "E_CROSS_03_04", "J_HAUL_03", "J_HAUL_04",
            "Bench Intermediate Cross Cut", speed_limit_kmh=30.0, lanes=1,
            override_gradient_pct=2.0, risk_penalty=5.0
        ),

        # East Pit route
        "E_SPINE_02": make_edge(
            "E_SPINE_02", "J_HAUL_02", "J_HAUL_06",
            "East Pit Trunk Haul", speed_limit_kmh=40.0, lanes=2,
            override_gradient_pct=-3.0
        ),
        "E_EAST_RAMP_01": make_edge(
            "E_EAST_RAMP_01", "J_HAUL_06", "J_HAUL_07",
            "East Pit Incline Ramp", speed_limit_kmh=30.0, lanes=2,
            override_gradient_pct=-7.5
        ),
        "E_EAST_RAMP_02": make_edge(
            "E_EAST_RAMP_02", "J_HAUL_07", "WP_EAST_PIT_APPROACH",
            "East Pit Deep Descent", speed_limit_kmh=25.0, lanes=2,
            override_gradient_pct=-8.0
        ),
        "E_EAST_FACE": make_edge(
            "E_EAST_FACE", "WP_EAST_PIT_APPROACH", "PICKUP_EAST_PIT",
            "East Pit Shovel Face Approach", speed_limit_kmh=20.0, lanes=2,
            override_gradient_pct=-2.0
        ),

        # South Waste Dump route
        "E_WASTE_01": make_edge(
            "E_WASTE_01", "J_HAUL_06", "J_HAUL_08",
            "Waste Overburden Link", speed_limit_kmh=35.0, lanes=2,
            override_gradient_pct=1.5
        ),
        "E_WASTE_02": make_edge(
            "E_WASTE_02", "J_HAUL_08", "WP_WASTE_APPROACH",
            "Waste Dump Ramp", speed_limit_kmh=25.0, lanes=2,
            override_gradient_pct=2.0
        ),
        "E_WASTE_03": make_edge(
            "E_WASTE_03", "WP_WASTE_APPROACH", "DUMP_WASTE_SOUTH",
            "Waste Tipping Crest", speed_limit_kmh=20.0, lanes=2,
            override_gradient_pct=0.5
        ),
    }

    return MineNetwork(
        network_id="NMDC_BAILADILA_DEP_05_NET",
        name="NMDC Bailadila Deposit 5 Haul Network",
        mine_site="Bailadila Iron Ore Complex, Chhattisgarh",
        nodes=nodes,
        edges=edges,
    )
