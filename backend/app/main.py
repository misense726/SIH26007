from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import __version__
from backend.app.api.routes import api_router, telemetry_socket
from backend.app.config import RuntimeSettings, load_project_config, runtime_settings
from backend.app.live_runtime import LiveSerialRuntime, SerialFactory
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore


def create_app(
    settings: RuntimeSettings | None = None,
    serial_factory: SerialFactory | None = None,
) -> FastAPI:
    active_settings = settings or runtime_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = active_settings
        app.state.world_store = WorldStore()
        config = load_project_config(active_settings)
        if active_settings.runtime_mode == "LIVE":
            assert active_settings.serial_port is not None
            app.state.simulator = None
            app.state.runtime = LiveSerialRuntime(
                app.state.world_store,
                config=config,
                port=active_settings.serial_port,
                baud=active_settings.serial_baud,
                stale_timeout_ms=active_settings.serial_stale_ms,
                poll_interval_ms=active_settings.serial_poll_interval_ms,
                reconnect_ms=active_settings.serial_reconnect_ms,
                **({"serial_factory": serial_factory} if serial_factory else {}),
            )
            app.state.live_runtime = app.state.runtime
        else:
            app.state.simulator = FullSimulator(
                app.state.world_store,
                config=config,
                telemetry_hz=active_settings.telemetry_hz,
            )
            app.state.runtime = app.state.simulator
            app.state.live_runtime = None
        await app.state.runtime.start()
        try:
            yield
        finally:
            await app.state.runtime.stop()

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
