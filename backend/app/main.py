from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import __version__
from backend.app.api.routes import api_router, telemetry_socket
from backend.app.camera import CameraFeed, LiveCameraStream
from backend.app.camera.dehaze import DehazeFormerEnhancer
from backend.app.camera.ir_enhance import IREnhancer
from backend.app.config import RuntimeSettings, load_project_config, runtime_settings
from backend.app.live_runtime import LiveSerialRuntime, SerialFactory
from backend.app.providers.redundant_reader import (
    RedundantTelemetryReader,
    TelemetrySource,
)
from backend.app.providers.serial_port import MainControllerSerial
from backend.app.providers.wifi_listener import WifiTelemetryListener
from backend.app.analytics import HaulageAnalyticsEngine
from backend.app.mine_map import MineRoadGraph
from backend.app.simulation.engine import FullSimulator
from backend.app.sensor_settings import SensorSettingsStore
from backend.app.twin.world_store import WorldStore
from backend.app.v2x import V2XManager


def create_app(
    settings: RuntimeSettings | None = None,
    serial_factory: SerialFactory | None = None,
    camera_feed: CameraFeed | None = None,
) -> FastAPI:
    active_settings = settings or runtime_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = active_settings
        app.state.world_store = WorldStore()
        active_camera_feed = camera_feed
        if active_camera_feed is None and active_settings.camera_stream_url:
            enhancer = (
                DehazeFormerEnhancer(
                    active_settings.camera_dehaze_model_root,
                    device=active_settings.camera_dehaze_device,
                    use_fp16=active_settings.camera_dehaze_fp16,
                )
                if active_settings.camera_dehaze_enabled
                else None
            )
            ir_enhancer = (
                IREnhancer(
                    device=active_settings.camera_ir_device,
                    use_fp16=active_settings.camera_ir_fp16,
                    colormap=active_settings.camera_ir_colormap,
                )
                if active_settings.camera_ir_enabled
                else None
            )
            active_camera_feed = LiveCameraStream(
                active_settings.camera_stream_url,
                stale_ms=active_settings.camera_stale_ms,
                reconnect_ms=active_settings.camera_reconnect_ms,
                open_timeout_ms=active_settings.camera_open_timeout_ms,
                read_timeout_ms=active_settings.camera_read_timeout_ms,
                jpeg_quality=active_settings.camera_jpeg_quality,
                metrics_interval_ms=active_settings.camera_metrics_interval_ms,
                enhancer=enhancer,
                enhancement_max_fps=active_settings.camera_dehaze_max_fps,
                ir_enhancer=ir_enhancer,
                ir_max_fps=active_settings.camera_ir_max_fps,
                rotation=active_settings.camera_rotation,
            )
        app.state.camera_feed = active_camera_feed
        if active_camera_feed is not None:
            await active_camera_feed.start()
        config = load_project_config(active_settings)
        app.state.sensor_settings = SensorSettingsStore(
            config,
            active_settings.sensor_settings_path,
        )
        v2x_manager = V2XManager(node_id="DUMPER_01", seed_demo=active_settings.runtime_mode != "LIVE")
        app.state.v2x_manager = v2x_manager
        if active_settings.runtime_mode == "LIVE":
            app.state.simulator = None
            if active_settings.telemetry_transport == "WIFI":
                source_port = (
                    f"{active_settings.wifi_listen_host}:"
                    f"{active_settings.wifi_listen_port}"
                )
                source_factory = serial_factory or (
                    lambda _port, _baud: WifiTelemetryListener(
                        active_settings.wifi_listen_host,
                        active_settings.wifi_listen_port,
                    )
                )
                source_name = "MAIN Wi-Fi"
            elif active_settings.telemetry_transport == "BOTH":
                assert active_settings.serial_port is not None
                wifi_endpoint = (
                    f"{active_settings.wifi_listen_host}:"
                    f"{active_settings.wifi_listen_port}"
                )
                source_port = (
                    f"USB {active_settings.serial_port} + WIFI {wifi_endpoint}"
                )
                source_factory = serial_factory or (
                    lambda _port, _baud: RedundantTelemetryReader(
                        (
                            TelemetrySource(
                                name="USB",
                                endpoint=active_settings.serial_port or "",
                                open_reader=lambda: MainControllerSerial(
                                    active_settings.serial_port or "",
                                    active_settings.serial_baud,
                                ),
                            ),
                            TelemetrySource(
                                name="Wi-Fi",
                                endpoint=wifi_endpoint,
                                open_reader=lambda: WifiTelemetryListener(
                                    active_settings.wifi_listen_host,
                                    active_settings.wifi_listen_port,
                                ),
                            ),
                        ),
                        reconnect_ms=active_settings.serial_reconnect_ms,
                        source_stale_ms=active_settings.serial_stale_ms,
                    )
                )
                source_name = "MAIN USB + Wi-Fi"
            else:
                assert active_settings.serial_port is not None
                source_port = active_settings.serial_port
                source_factory = serial_factory or MainControllerSerial
                source_name = "MAIN serial"
            app.state.runtime = LiveSerialRuntime(
                app.state.world_store,
                config=config,
                port=source_port,
                baud=active_settings.serial_baud,
                stale_timeout_ms=active_settings.serial_stale_ms,
                poll_interval_ms=active_settings.serial_poll_interval_ms,
                reconnect_ms=active_settings.serial_reconnect_ms,
                camera_feed=active_camera_feed,
                serial_factory=source_factory,
                source_name=source_name,
                transport=active_settings.telemetry_transport,
                reported_serial_port=active_settings.serial_port,
                v2x_manager=v2x_manager,
            )
            app.state.live_runtime = app.state.runtime
            app.state.mine_graph = MineRoadGraph()
            app.state.analytics = HaulageAnalyticsEngine(seed_baseline=False)
            app.state.fleet_manager = None
        else:
            app.state.simulator = FullSimulator(
                app.state.world_store,
                config=config,
                telemetry_hz=active_settings.telemetry_hz,
                camera_feed=active_camera_feed,
                v2x_manager=v2x_manager,
            )
            app.state.runtime = app.state.simulator
            app.state.live_runtime = None
            app.state.mine_graph = app.state.simulator.mine_graph
            app.state.analytics = app.state.simulator.analytics
            app.state.fleet_manager = app.state.simulator.fleet_manager
        await app.state.runtime.start()
        try:
            yield
        finally:
            await app.state.runtime.stop()
            if active_camera_feed is not None:
                await active_camera_feed.stop()

    app = FastAPI(
        title="MI Sense API",
        version=__version__,
        description="Backend-owned world model for the MI Sense V1 proof of concept.",
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
