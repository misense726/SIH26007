from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from backend.app.models import (
    ReferenceMap,
    SimulationControlRequest,
    SimulationState,
    SystemStatus,
    WorldState,
)


api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "fogsen-backend"}


@api_router.get("/status", response_model=SystemStatus)
async def status(request: Request) -> SystemStatus:
    snapshot = await request.app.state.world_store.snapshot()
    return SystemStatus(
        telemetry_hz=request.app.state.settings.telemetry_hz,
        world_sequence=snapshot.sequence,
        mode=snapshot.mode,
    )


@api_router.get("/world", response_model=WorldState)
async def world(request: Request) -> WorldState:
    return await request.app.state.world_store.snapshot()


@api_router.get("/simulation", response_model=SimulationState)
async def simulation(request: Request) -> SimulationState:
    return request.app.state.simulator.simulation_state()


@api_router.post("/simulation/control", response_model=SimulationState)
async def control_simulation(
    request: Request,
    control: SimulationControlRequest,
) -> SimulationState:
    state = await request.app.state.simulator.apply_control_and_tick(
        **control.model_dump()
    )
    return state.simulation


@api_router.get("/map", response_model=ReferenceMap)
async def reference_map(request: Request) -> ReferenceMap:
    return request.app.state.simulator.reference_map


@api_router.put("/map", response_model=ReferenceMap)
async def replace_reference_map(request: Request, reference_map: ReferenceMap) -> ReferenceMap:
    await request.app.state.simulator.set_reference_map(reference_map)
    return request.app.state.simulator.reference_map


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
