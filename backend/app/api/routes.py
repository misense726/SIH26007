from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from backend.app.analytics.models import HaulageMetrics, TripHistoryResponse
from backend.app.fleet.models import FleetVehicleSummary
from backend.app.mine_map.models import MineEdge, MineNetwork, RoadStatus
from backend.app.models import (
    DataMode,
    ReferenceMap,
    SimulationControlRequest,
    SimulationState,
    SystemStatus,
    V2IAdvisoryMessage,
    V2IAdvisoryType,
    V2VBasicSafetyMessage,
    V2XState,
    WorldState,
)
from backend.app.navigation.models import NavigationRoute, RouteRequest
from backend.app.navigation.router import RouteOptimizer
from backend.app.sensor_settings import (
    SensorDisplaySetting,
    SensorDisplayUpdate,
    SensorId,
    SensorSettingsState,
)
from backend.app.models.device import VehicleTelemetryPacket


class EdgeStatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: RoadStatus
    risk_penalty: float | None = None
    speed_limit_kmh: float | None = None
    reason: str = "Dispatch road status update"


class GuidanceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicle_id: str
    callsign: str
    current_destination: str
    distance_remaining_m: float
    next_instruction: str
    speed_kmh: float
    target_vehicle_id: str
    target_callsign: str
    hazard_distance_m: float
    hazard_direction: str
    closing_velocity_mps: float
    threat_level: str
    advisory_text: str
    visibility_score: float
    visibility_state: str
    estimated_sight_distance_m: float


api_router = APIRouter(prefix="/api")

@api_router.post("/telemetry/vehicle")
async def receive_vehicle(packet: VehicleTelemetryPacket, request: Request) -> dict[str, str]:
    if request.app.state.settings.runtime_mode != "LIVE":
        raise HTTPException(status_code=409, detail="Vehicle telemetry requires LIVE mode")
    await request.app.state.world_store.accept_vehicle(packet)
    return {"status": "accepted", "vehicle_id": packet.vehicle_id}


@api_router.get("/health")
async def health(request: Request) -> dict[str, str]:
    live_runtime = getattr(request.app.state, "live_runtime", None)
    status_value = live_runtime.status if live_runtime is not None else "ok"
    return {"status": status_value, "service": "fogsen-backend"}


@api_router.get("/status", response_model=SystemStatus)
async def status(request: Request) -> SystemStatus:
    snapshot = await request.app.state.world_store.snapshot()
    live_runtime = getattr(request.app.state, "live_runtime", None)
    return SystemStatus(
        telemetry_hz=request.app.state.settings.telemetry_hz,
        world_sequence=snapshot.sequence,
        mode=snapshot.mode,
        status=live_runtime.status if live_runtime is not None else "ok",
        runtime_detail=(
            live_runtime.status_detail if live_runtime is not None else None
        ),
        serial_port=live_runtime.serial_port if live_runtime is not None else None,
        telemetry_transport=(
            live_runtime.telemetry_transport
            if live_runtime is not None
            else "SIMULATED"
        ),
        telemetry_endpoint=(
            live_runtime.telemetry_endpoint if live_runtime is not None else None
        ),
        active_telemetry_sources=(
            live_runtime.active_telemetry_sources
            if live_runtime is not None
            else []
        ),
        telemetry_source_errors=(
            live_runtime.telemetry_source_errors
            if live_runtime is not None
            else {}
        ),
        last_telemetry_ms=(
            live_runtime.last_telemetry_ms if live_runtime is not None else None
        ),
    )


@api_router.get("/world", response_model=WorldState)
async def world(request: Request) -> WorldState:
    return await request.app.state.world_store.snapshot()


@api_router.get("/sensor-settings", response_model=SensorSettingsState)
async def sensor_settings(request: Request) -> SensorSettingsState:
    return request.app.state.sensor_settings.snapshot()


@api_router.put(
    "/sensor-settings/{sensor_id}",
    response_model=SensorDisplaySetting,
)
async def update_sensor_settings(
    request: Request,
    sensor_id: SensorId,
    update: SensorDisplayUpdate,
) -> SensorDisplaySetting:
    try:
        return request.app.state.sensor_settings.update(sensor_id, update)
    except OSError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Sensor display settings could not be saved: {exc}",
        ) from exc


@api_router.get("/camera/status")
async def camera_status(request: Request) -> dict[str, object]:
    camera_feed = request.app.state.camera_feed
    if camera_feed is None:
        return {
            "configured": False,
            "status": "disabled",
            "detail": "No camera stream is configured",
            "raw_available": False,
        }
    return camera_feed.status_payload()


@api_router.get("/camera/frame")
async def camera_frame(
    request: Request,
    view: Literal["raw", "enhanced", "ir"] = "raw",
) -> Response:
    camera_feed = request.app.state.camera_feed
    if camera_feed is None:
        raise HTTPException(status_code=503, detail="Camera is not configured")
    snapshot = camera_feed.snapshot()
    if view == "ir":
        jpeg = snapshot.ir_jpeg
        frame_id = snapshot.ir_frame_id
    elif view == "enhanced":
        jpeg = snapshot.enhanced_jpeg
        frame_id = snapshot.enhanced_frame_id
    else:
        jpeg = snapshot.raw_jpeg
        frame_id = snapshot.frame_id
    if jpeg is None:
        raise HTTPException(
            status_code=503,
            detail=(
                snapshot.ir_detail
                if view == "ir"
                else snapshot.enhancement_detail
                if view == "enhanced"
                else snapshot.detail
            )
            or f"{view.capitalize()} camera frame is unavailable",
        )
    return Response(
        jpeg,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-FogSen-Frame-Id": frame_id or "",
            "X-FogSen-Camera-View": view,
        },
    )


@api_router.get("/camera/stream")
async def camera_stream(
    request: Request,
    view: Literal["raw", "enhanced", "ir"] = "raw",
) -> StreamingResponse:
    camera_feed = request.app.state.camera_feed
    if camera_feed is None:
        raise HTTPException(status_code=503, detail="Camera is not configured")

    async def frames():
        last_frame_id: str | None = None
        while True:
            snapshot = camera_feed.snapshot()
            if view == "ir":
                jpeg = snapshot.ir_jpeg
                frame_id = snapshot.ir_frame_id
            elif view == "enhanced":
                jpeg = snapshot.enhanced_jpeg
                frame_id = snapshot.enhanced_frame_id
            else:
                jpeg = snapshot.raw_jpeg
                frame_id = snapshot.frame_id
            if jpeg is not None and frame_id != last_frame_id:
                last_frame_id = frame_id
                yield (
                    b"--fogsen-frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii")
                    + jpeg
                    + b"\r\n"
                )
            await asyncio.sleep(0.02)

    return StreamingResponse(
        frames(),
        media_type="multipart/x-mixed-replace; boundary=fogsen-frame",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@api_router.get("/simulation", response_model=SimulationState)
async def simulation(request: Request) -> SimulationState:
    if request.app.state.simulator is None:
        raise HTTPException(
            status_code=409,
            detail="Simulation controls are unavailable in LIVE mode",
        )
    return request.app.state.simulator.simulation_state()


@api_router.post("/simulation/control", response_model=SimulationState)
async def control_simulation(
    request: Request,
    control: SimulationControlRequest,
) -> SimulationState:
    if request.app.state.simulator is None:
        raise HTTPException(
            status_code=409,
            detail="Simulation controls are unavailable in LIVE mode",
        )
    state = await request.app.state.simulator.apply_control_and_tick(
        **control.model_dump()
    )
    return state.simulation


@api_router.get("/map", response_model=ReferenceMap)
async def reference_map(request: Request) -> ReferenceMap:
    return request.app.state.runtime.reference_map


@api_router.put("/map", response_model=ReferenceMap)
async def replace_reference_map(request: Request, reference_map: ReferenceMap) -> ReferenceMap:
    await request.app.state.runtime.set_reference_map(reference_map)
    return request.app.state.runtime.reference_map


@api_router.get("/v2x/state", response_model=V2XState)
async def v2x_state(request: Request) -> V2XState:
    v2x_manager = getattr(request.app.state, "v2x_manager", None)
    if v2x_manager is None:
        raise HTTPException(status_code=503, detail="V2X subsystem is offline")
    return v2x_manager.snapshot()


@api_router.post("/v2x/messages/bsm", response_model=dict[str, str])
async def receive_v2v_bsm(request: Request, bsm: V2VBasicSafetyMessage) -> dict[str, str]:
    v2x_manager = getattr(request.app.state, "v2x_manager", None)
    if v2x_manager is None:
        raise HTTPException(status_code=503, detail="V2X subsystem is offline")
    v2x_manager.receive_bsm(bsm)
    return {"status": "accepted", "message_id": bsm.message_id}


@api_router.post("/v2x/broadcast-advisory", response_model=dict[str, str])
async def broadcast_v2i_advisory(request: Request, advisory: V2IAdvisoryMessage) -> dict[str, str]:
    v2x_manager = getattr(request.app.state, "v2x_manager", None)
    if v2x_manager is None:
        raise HTTPException(status_code=503, detail="V2X subsystem is offline")
    v2x_manager.broadcast_advisory(advisory)
    return {"status": "broadcasted", "message_id": advisory.message_id}


@api_router.get("/mine/network", response_model=MineNetwork)
async def mine_network(request: Request) -> MineNetwork:
    mine_graph = getattr(request.app.state, "mine_graph", None)
    if mine_graph is None:
        raise HTTPException(status_code=503, detail="Mine road graph is offline")
    return mine_graph.network


@api_router.post("/mine/edges/{edge_id}/status", response_model=MineEdge)
async def update_mine_edge_status(
    request: Request,
    edge_id: str,
    update: EdgeStatusUpdateRequest,
) -> MineEdge:
    mine_graph = getattr(request.app.state, "mine_graph", None)
    if mine_graph is None:
        raise HTTPException(status_code=503, detail="Mine road graph is offline")

    updated = mine_graph.update_edge_status(
        edge_id,
        update.status,
        risk_penalty=update.risk_penalty,
        speed_limit_kmh=update.speed_limit_kmh,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Edge '{edge_id}' not found")

    # Broadcast V2I advisory if status changed to RESTRICTED or CLOSED
    v2x_manager = getattr(request.app.state, "v2x_manager", None)
    if v2x_manager and update.status != RoadStatus.OPEN:
        adv = V2IAdvisoryMessage(
            message_id=f"ADV-ROAD-{edge_id}-{int(asyncio.get_event_loop().time() * 1000)}",
            rsu_id="RSU_CENTRAL_DISPATCH",
            rsu_name="NMDC Mine Central Dispatch",
            advisory_type=V2IAdvisoryType.ROAD_MAINTENANCE,
            title=f"Road Status Update: {updated.segment_name or edge_id} is {update.status.value}",
            detail=update.reason,
            speed_limit_kmh=update.speed_limit_kmh,
        )
        v2x_manager.broadcast_advisory(adv)

    # Dynamic rerouting for any active vehicle navigating this edge
    fleet_manager = getattr(request.app.state, "fleet_manager", None)
    if fleet_manager:
        for veh in fleet_manager.vehicles.values():
            if veh.current_route and update.status in {RoadStatus.CLOSED, RoadStatus.RESTRICTED}:
                router = RouteOptimizer(mine_graph)
                advisory = router.check_dynamic_reroute(
                    veh.current_route,
                    edge_id,
                    current_node_id=veh.current_node_id,
                    reason=update.reason,
                )
                if advisory:
                    veh.assign_route(advisory.new_route)
                    fleet_manager.add_reroute_advisory(advisory)

    return updated


@api_router.post("/navigation/route", response_model=NavigationRoute)
async def calculate_route(request: Request, body: RouteRequest) -> NavigationRoute:
    mine_graph = getattr(request.app.state, "mine_graph", None)
    if mine_graph is None:
        raise HTTPException(status_code=503, detail="Mine road network is offline")

    router = RouteOptimizer(mine_graph)
    route = router.find_route(body)
    if not route:
        raise HTTPException(
            status_code=404,
            detail=f"No viable route found from '{body.start_node_id}' to '{body.end_node_id}' (possible road closures).",
        )
    return route


@api_router.get("/navigation/guidance", response_model=GuidanceResponse)
async def navigation_guidance(
    request: Request,
    vehicle_id: str = Query(default="DUMPER_01"),
) -> GuidanceResponse:
    world_state = await request.app.state.world_store.snapshot()
    fleet_manager = getattr(request.app.state, "fleet_manager", None)

    if fleet_manager is None:
        if world_state.mode == DataMode.LIVE:
            raise HTTPException(
                status_code=503,
                detail="Operational vehicle guidance is offline in live hardware mode",
            )
        raise HTTPException(
            status_code=503,
            detail="Fleet guidance subsystem is offline",
        )

    veh = fleet_manager.get_vehicle(vehicle_id)
    if veh is None:
        raise HTTPException(
            status_code=404,
            detail=f"Vehicle '{vehicle_id}' not found in active fleet",
        )

    callsign = veh.callsign
    destination = veh.assigned_dump if veh.payload_tonnes > 0 else veh.assigned_pickup
    dist_rem = veh.distance_to_dest_m
    instruction = veh.next_instruction
    speed_kmh = veh.speed_mps * 3.6

    threat = fleet_manager.get_tactical_collision_warning(vehicle_id)

    vis_score = world_state.environment.visibility_score
    vis_state = world_state.environment.visibility_state.value
    # Approximate physical sight distance in meters based on atmospheric extinction
    sight_distance = round(max(8.0, vis_score * 120.0), 1)

    return GuidanceResponse(
        vehicle_id=vehicle_id,
        callsign=callsign,
        current_destination=destination,
        distance_remaining_m=round(dist_rem, 1),
        next_instruction=instruction,
        speed_kmh=round(speed_kmh, 1),
        target_vehicle_id=threat.target_vehicle_id,
        target_callsign=threat.target_callsign,
        hazard_distance_m=threat.distance_m,
        hazard_direction=threat.direction,
        closing_velocity_mps=threat.closing_velocity_mps,
        threat_level=threat.threat_level,
        advisory_text=threat.advisory_text,
        visibility_score=round(vis_score, 2),
        visibility_state=vis_state,
        estimated_sight_distance_m=sight_distance,
    )


@api_router.get("/fleet/vehicles", response_model=list[FleetVehicleSummary])
async def fleet_vehicles(request: Request) -> list[FleetVehicleSummary]:
    simulator = getattr(request.app.state, "simulator", None)
    if simulator is not None:
        return simulator.get_fleet_summaries()
    fleet_manager = getattr(request.app.state, "fleet_manager", None)
    if fleet_manager is None:
        return []
    return fleet_manager.get_all_summaries()


@api_router.get("/analytics/haulage-metrics", response_model=HaulageMetrics)
async def haulage_metrics(request: Request) -> HaulageMetrics:
    analytics = getattr(request.app.state, "analytics", None)
    if analytics is None:
        raise HTTPException(status_code=503, detail="Analytics subsystem is offline")
    fleet_manager = getattr(request.app.state, "fleet_manager", None)
    simulator = getattr(request.app.state, "simulator", None)
    count = simulator.active_fleet_count if simulator is not None else len(fleet_manager.vehicles) if fleet_manager else 0
    return analytics.get_haulage_metrics(active_fleet_count=count)


@api_router.get("/analytics/trip-history", response_model=TripHistoryResponse)
async def trip_history(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    vehicle_id: str | None = Query(default=None),
) -> TripHistoryResponse:
    analytics = getattr(request.app.state, "analytics", None)
    if analytics is None:
        raise HTTPException(status_code=503, detail="Analytics subsystem is offline")
    return analytics.get_trip_history(limit=limit, vehicle_id=vehicle_id)


async def telemetry_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    last_sequence = -1
    try:
        while True:
            snapshot = await websocket.app.state.world_store.stream_snapshot(last_sequence)
            if snapshot is not None:
                last_sequence, payload = snapshot
                await websocket.send_text(payload)
            await asyncio.sleep(0.04)
    except WebSocketDisconnect:
        return
