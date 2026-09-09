from __future__ import annotations

"""Simulation-only FastAPI application used by the Vercel deployment.

The normal application also wires USB/Wi-Fi hardware and camera processing.
The hosted demo has one purpose: expose the deterministic server-side
simulation and its shared world state without loading those hardware paths.
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.app import __version__
from backend.app.api.routes import api_router, telemetry_socket
from backend.app.config import RuntimeSettings, load_project_config, runtime_settings
from backend.app.sensor_settings import SensorSettingsStore
from backend.app.simulation.engine import FullSimulator
from backend.app.twin.world_store import WorldStore
from backend.app.v2x import V2XManager


def create_simulation_app(settings: RuntimeSettings | None = None) -> FastAPI:
    """Create an app that always runs the backend-owned simulator."""

    requested_settings = settings or runtime_settings()
    active_settings = requested_settings.model_copy(
        update={
            "runtime_mode": "SIMULATED",
            "camera_stream_url": None,
            "camera_dehaze_enabled": False,
            "camera_ir_enabled": False,
            # Vercel's deployment filesystem is read-only. Dashboard-only
            # settings can still work for the lifetime of this function in /tmp.
            "sensor_settings_path": Path("/tmp/fogsen-sensor-display.json"),
        }
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = active_settings
        app.state.world_store = WorldStore()
        app.state.camera_feed = None

        config = load_project_config(active_settings)
        app.state.sensor_settings = SensorSettingsStore(
            config,
            active_settings.sensor_settings_path,
        )
        v2x_manager = V2XManager(node_id="DUMPER_01")
        app.state.v2x_manager = v2x_manager
        simulator = FullSimulator(
            app.state.world_store,
            config=config,
            telemetry_hz=active_settings.telemetry_hz,
            camera_feed=None,
            v2x_manager=v2x_manager,
        )
        app.state.simulator = simulator
        app.state.runtime = simulator
        app.state.live_runtime = None
        await simulator.start()
        try:
            yield
        finally:
            await simulator.stop()

    app = FastAPI(
        title="FogSen Simulation API",
        version=__version__,
        description="Server-side simulated FogSen world state for the hosted demo.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    # Vercel routes Python functions under /api. Keep the local path too so
    # the same telemetry handler remains usable outside the hosted build.
    app.add_api_websocket_route("/api/ws/telemetry", telemetry_socket)
    app.add_api_websocket_route("/ws/telemetry", telemetry_socket)
    app.mount(
        "/",
        StaticFiles(directory="frontend/dist", html=True, check_dir=False),
        name="dashboard",
    )
    return app


app = create_simulation_app()
