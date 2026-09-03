from __future__ import annotations

import heapq
import math
import uuid
from typing import NamedTuple

from backend.app.mine_map.graph import MineRoadGraph
from backend.app.mine_map.models import MineEdge, RoadStatus
from backend.app.models.telemetry import Point2D
from backend.app.navigation.models import (
    NavigationRoute,
    RerouteAdvisory,
    RouteCostBreakdown,
    RouteCostWeights,
    RouteRequest,
)


class EdgeTraversalCost(NamedTuple):
    total_cost: float
    distance_cost: float
    time_cost: float
    payload_cost: float
    road_condition_cost: float
    gradient_cost: float
    traffic_cost: float
    safety_cost: float
    effective_speed_kmh: float
    travel_time_s: float
    traversal_gradient: float


class RouteOptimizer:
    """Multi-criteria Dijkstra / A* route optimizer for mine haul networks."""

    def __init__(self, mine_graph: MineRoadGraph) -> None:
        self.mine_graph = mine_graph

    def calculate_edge_cost(
        self,
        edge: MineEdge,
        traversal_gradient: float,
        payload_tonnes: float,
        tare_weight_tonnes: float,
        weights: RouteCostWeights,
    ) -> EdgeTraversalCost | None:
        """Calculate weighted multi-criteria traversal cost for a directed edge."""
        # Closed roads cannot be traversed
        if edge.road_status == RoadStatus.CLOSED:
            return None

        distance = edge.distance_m
        payload_ratio = payload_tonnes / 100.0  # 0.0 empty, 1.0 at 100T nominal ore payload

        # 1. Distance cost
        dist_cost = weights.w1_distance * distance

        # 2. Gradient cost & Payload uphill penalty
        grad = traversal_gradient
        grad_cost = 0.0
        payload_cost = 0.0

        if grad > 0:
            # Uphill: climbing gradient cost scales with grade and vehicle mass
            grad_cost = (
                weights.w5_gradient_penalty
                * distance
                * (grad / 10.0)
                * (0.3 + 2.5 * payload_ratio)
            )
            # Heavy payload climbing steep grade penalty (exponential above 6% grade)
            payload_cost = (
                weights.w3_payload_penalty
                * distance
                * payload_ratio
                * ((grad / 6.0) ** 2)
            )
        else:
            # Downhill: brake retarder thermal load on steep slopes with heavy payload
            abs_grad = abs(grad)
            if abs_grad > 7.0 and payload_ratio > 0.3:
                payload_cost = (
                    weights.w3_payload_penalty
                    * distance
                    * payload_ratio
                    * ((abs_grad / 7.0) ** 1.8)
                )

        # 3. Travel time cost with gradient & payload speed reduction
        speed_reduction = 1.0
        if grad > 0 and payload_ratio > 0:
            # Loaded truck climbing steep grade slows down
            speed_reduction = max(0.4, 1.0 - (payload_ratio * (grad / 20.0)))
        elif grad < -8.0 and payload_ratio > 0.5:
            # Loaded truck descending steep grade must retard
            speed_reduction = max(0.45, 1.0 - (payload_ratio * (abs(grad) / 22.0)))

        effective_speed_kmh = max(8.0, edge.speed_limit_kmh * speed_reduction)
        effective_speed_mps = effective_speed_kmh / 3.6
        travel_time_s = distance / effective_speed_mps
        time_cost = weights.w2_travel_time * travel_time_s

        # 4. Road condition penalty
        road_condition_cost = 0.0
        if edge.road_status == RoadStatus.RESTRICTED:
            road_condition_cost = weights.w4_road_condition * 15.0

        # 5. Traffic penalty (fewer lanes = higher opposing traffic hazard)
        traffic_cost = weights.w6_traffic_penalty * distance * (2.0 / max(1, edge.lanes))

        # 6. Safety / Risk penalty from edge attributes
        safety_cost = weights.w7_safety_penalty * edge.risk_penalty

        total_cost = (
            dist_cost
            + time_cost
            + payload_cost
            + road_condition_cost
            + grad_cost
            + traffic_cost
            + safety_cost
        )

        return EdgeTraversalCost(
            total_cost=total_cost,
            distance_cost=dist_cost,
            time_cost=time_cost,
            payload_cost=payload_cost,
            road_condition_cost=road_condition_cost,
            gradient_cost=grad_cost,
            traffic_cost=traffic_cost,
            safety_cost=safety_cost,
            effective_speed_kmh=effective_speed_kmh,
            travel_time_s=travel_time_s,
            traversal_gradient=grad,
        )

    def find_route(self, request: RouteRequest) -> NavigationRoute | None:
        """Find optimal route using multi-criteria Dijkstra search."""
        start_node = self.mine_graph.get_node(request.start_node_id)
        end_node = self.mine_graph.get_node(request.end_node_id)
        if not start_node or not end_node:
            return None

        # Priority queue: (total_cost, current_node_id)
        queue: list[tuple[float, str]] = [(0.0, request.start_node_id)]
        distances: dict[str, float] = {request.start_node_id: 0.0}
        previous: dict[str, tuple[str, MineEdge, EdgeTraversalCost]] = {}

        while queue:
            current_cost, current_node_id = heapq.heappop(queue)

            if current_node_id == request.end_node_id:
                break

            if current_cost > distances.get(current_node_id, float("inf")):
                continue

            outgoing = self.mine_graph.get_outgoing_edges(current_node_id)
            for edge in outgoing:
                target_node_id = edge.to_node if edge.from_node == current_node_id else edge.from_node
                target_node = self.mine_graph.get_node(target_node_id)
                if not target_node:
                    continue

                # Traversal gradient
                traversal_gradient = (
                    edge.gradient_pct
                    if edge.from_node == current_node_id
                    else -edge.gradient_pct
                )

                edge_cost = self.calculate_edge_cost(
                    edge=edge,
                    traversal_gradient=traversal_gradient,
                    payload_tonnes=request.payload_tonnes,
                    tare_weight_tonnes=request.tare_weight_tonnes,
                    weights=request.weights,
                )
                if edge_cost is None:
                    continue  # road closed

                tentative_cost = current_cost + edge_cost.total_cost
                if tentative_cost < distances.get(target_node_id, float("inf")):
                    distances[target_node_id] = tentative_cost
                    previous[target_node_id] = (current_node_id, edge, edge_cost)
                    heapq.heappush(queue, (tentative_cost, target_node_id))

        if request.end_node_id not in previous and request.start_node_id != request.end_node_id:
            return None

        # Reconstruct path
        path_nodes: list[str] = [request.end_node_id]
        edge_ids: list[str] = []
        traversed_edge_costs: list[EdgeTraversalCost] = []

        curr = request.end_node_id
        while curr != request.start_node_id:
            prev_node, edge_used, cost_info = previous[curr]
            path_nodes.append(prev_node)
            edge_ids.append(edge_used.edge_id)
            traversed_edge_costs.append(cost_info)
            curr = prev_node

        path_nodes.reverse()
        edge_ids.reverse()
        traversed_edge_costs.reverse()

        # Compute totals and breakdowns
        total_dist = sum(c.distance_cost / request.weights.w1_distance for c in traversed_edge_costs) if request.weights.w1_distance > 0 else 0.0
        total_time_s = sum(c.travel_time_s for c in traversed_edge_costs)
        max_grad = max((abs(c.traversal_gradient) for c in traversed_edge_costs), default=0.0)
        avg_speed_kmh = (
            (total_dist / (total_time_s / 3600.0) / 1000.0)
            if total_time_s > 0
            else 30.0
        )

        breakdown = RouteCostBreakdown(
            distance_cost=sum(c.distance_cost for c in traversed_edge_costs),
            time_cost=sum(c.time_cost for c in traversed_edge_costs),
            payload_cost=sum(c.payload_cost for c in traversed_edge_costs),
            road_condition_cost=sum(c.road_condition_cost for c in traversed_edge_costs),
            gradient_cost=sum(c.gradient_cost for c in traversed_edge_costs),
            traffic_cost=sum(c.traffic_cost for c in traversed_edge_costs),
            safety_cost=sum(c.safety_cost for c in traversed_edge_costs),
            total_cost=distances.get(request.end_node_id, 0.0),
        )

        # Collect waypoints
        waypoints: list[Point2D] = []
        for nid in path_nodes:
            n = self.mine_graph.get_node(nid)
            if n:
                waypoints.append(Point2D(x_m=n.x_m, y_m=n.y_m))

        instructions = self._generate_instructions(path_nodes, traversed_edge_costs)

        return NavigationRoute(
            route_id=f"ROUTE-{uuid.uuid4().hex[:8].upper()}",
            vehicle_id=request.vehicle_id,
            start_node_id=request.start_node_id,
            end_node_id=request.end_node_id,
            payload_tonnes=request.payload_tonnes,
            path_nodes=path_nodes,
            edge_ids=edge_ids,
            total_distance_m=round(total_dist, 1),
            estimated_time_s=round(total_time_s, 1),
            max_gradient_pct=round(max_grad, 1),
            average_speed_kmh=round(avg_speed_kmh, 1),
            total_cost=round(breakdown.total_cost, 2),
            cost_breakdown=breakdown,
            waypoints=waypoints,
            instructions=instructions,
        )

    def _generate_instructions(
        self,
        path_nodes: list[str],
        edge_costs: list[EdgeTraversalCost],
    ) -> list[str]:
        """Generate human-readable driver navigation instructions."""
        if len(path_nodes) < 2:
            return ["Arrived at destination."]

        instructions: list[str] = []
        for i in range(len(path_nodes) - 1):
            curr_id = path_nodes[i]
            next_id = path_nodes[i + 1]
            curr_node = self.mine_graph.get_node(curr_id)
            next_node = self.mine_graph.get_node(next_id)
            if not curr_node or not next_node:
                continue

            cost_info = edge_costs[i]
            dist_m = round(cost_info.distance_cost, 0)
            grad = cost_info.traversal_gradient

            grade_desc = (
                f"uphill {abs(grad):.1f}% grade"
                if grad > 3.0
                else f"downhill {abs(grad):.1f}% grade"
                if grad < -3.0
                else "level road"
            )

            if i == 0:
                instructions.append(f"Depart {curr_node.name} onto {next_node.name} ({grade_desc}).")
            elif i == len(path_nodes) - 2:
                instructions.append(f"In {int(dist_m)}m arrive at {next_node.name}.")
            else:
                instructions.append(f"Continue past {curr_node.name} towards {next_node.name} ({grade_desc}).")

        return instructions

    def check_dynamic_reroute(
        self,
        current_route: NavigationRoute,
        closed_edge_id: str,
        current_node_id: str,
        reason: str = "Haul segment closed by dispatch",
    ) -> RerouteAdvisory | None:
        """Evaluate if an edge closure affects current route and calculate alternative."""
        base_closed = closed_edge_id.removesuffix("_REV")
        route_edges_base = [eid.removesuffix("_REV") for eid in current_route.edge_ids]

        if base_closed not in route_edges_base:
            return None  # Route unaffected

        # Determine new start from current position
        start_id = current_node_id
        if start_id not in self.mine_graph.nodes:
            start_id = current_route.start_node_id

        reroute_request = RouteRequest(
            start_node_id=start_id,
            end_node_id=current_route.end_node_id,
            payload_tonnes=current_route.payload_tonnes,
            vehicle_id=current_route.vehicle_id,
        )

        new_route = self.find_route(reroute_request)
        if not new_route:
            return None

        return RerouteAdvisory(
            advisory_id=f"REROUTE-{uuid.uuid4().hex[:8].upper()}",
            vehicle_id=current_route.vehicle_id,
            timestamp_ms=0,
            trigger_edge_id=closed_edge_id,
            trigger_reason=reason,
            original_route_id=current_route.route_id,
            new_route=new_route,
            alternate_found=True,
        )
