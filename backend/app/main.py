from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import __version__
from backend.app.api.routes import api_router, telemetry_socket
from backend.app.config import RuntimeSettings, runtime_settings
from backend.app.config import project_config
from backend.app.simulation.foundation import FoundationSimulator
from backend.app.twin.world_store import WorldStore


def create_app(settings: RuntimeSettings | None = None) -> FastAPI:
    active_settings = settings or runtime_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = active_settings
        app.state.world_store = WorldStore()
        demo = project_config()["demo"]["demo"]
        app.state.simulator = FoundationSimulator(
            app.state.world_store,
            telemetry_hz=active_settings.telemetry_hz,
            map_path=demo["map_file"],
            route_speed_mps=float(demo["route_speed_mps"]),
        )
        await app.state.simulator.start()
        try:
            yield
        finally:
            await app.state.simulator.stop()

    app = FastAPI(
        title="FogSen API",
        version=__version__,
        description="Backend-owned world model for the FogSen V1 proof of concept.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    app.add_api_websocket_route("/ws/telemetry", telemetry_socket)
    return app


app = create_app()


def run() -> None:
    settings = runtime_settings()
    uvicorn.run(
        "backend.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    run()
