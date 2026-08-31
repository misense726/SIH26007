from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from backend.app.models import (
    ReferenceMap,
    SimulationControlRequest,
    SimulationState,
    SystemStatus,
    V2IAdvisoryMessage,
    V2VBasicSafetyMessage,
    V2XState,
    WorldState,
)
from backend.app.sensor_settings import (
    SensorDisplaySetting,
    SensorDisplayUpdate,
    SensorId,
    SensorSettingsState,
)


api_router = APIRouter(prefix="/api")


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
            "detail": "No FogSen camera stream is configured",
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
        raise HTTPException(status_code=503, detail="FogSen camera is not configured")
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
            or f"FogSen {view} camera frame is unavailable",
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
        raise HTTPException(status_code=503, detail="FogSen camera is not configured")

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


async def telemetry_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    last_sequence = -1
    try:
        while True:
            snapshot = await websocket.app.state.world_store.snapshot()
            if snapshot.sequence != last_sequence:
                await websocket.send_text(snapshot.model_dump_json())
                last_sequence = snapshot.sequence
            await asyncio.sleep(0.04)
    except WebSocketDisconnect:
        return
