from __future__ import annotations

import time

import numpy as np
from fastapi.testclient import TestClient

from backend.app.camera import CameraFrameSnapshot, LiveCameraStream
from backend.app.main import create_app
from backend.app.models import CameraState, DataMode, VisibilityMetrics, VisibilityState


RAW_JPEG = b"\xff\xd8fogsen-raw\xff\xd9"
ENHANCED_JPEG = b"\xff\xd8fogsen-enhanced\xff\xd9"


class PassThroughEnhancer:
    name = "test-enhancer"
    device = "cpu"
    precision = "FP32"
    peak_vram_mb = 0.0

    def enhance(self, frame: np.ndarray) -> np.ndarray:
        return frame


class StaticCameraFeed:
    source_uri = "tcp://pi.test:8888"

    def __init__(self) -> None:
        self.started = False
        self.stopped = False
        self._snapshot = CameraFrameSnapshot(
            timestamp_ms=int(time.time() * 1_000),
            frame_id="raw-1",
            raw_jpeg=RAW_JPEG,
            enhanced_timestamp_ms=int(time.time() * 1_000),
            enhanced_frame_id="enhanced-1",
            enhanced_jpeg=ENHANCED_JPEG,
            metrics=VisibilityMetrics(
                contrast=0.55,
                edge_density=0.42,
                brightness=0.5,
                entropy=0.61,
                haze_proxy=0.4,
            ),
            visibility_score=0.44,
            visibility_state=VisibilityState.LOW,
            status="live",
            detail="Receiving the Raspberry Pi camera over Wi-Fi",
            width_px=1296,
            height_px=972,
            measured_fps=29.7,
            enhancement_status="live",
            enhancement_detail="ML dehazing is running on the laptop GPU",
            enhancement_model="DehazeFormer-MCT",
            enhancement_device="cuda",
            enhancement_precision="FP16",
            enhancement_latency_ms=18.0,
            enhancement_fps=15.0,
            enhancement_peak_vram_mb=512.0,
        )

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True

    def snapshot(self) -> CameraFrameSnapshot:
        return self._snapshot

    def camera_state(self) -> CameraState:
        snapshot = self._snapshot
        return CameraState(
            timestamp_ms=snapshot.timestamp_ms,
            raw_frame_id=snapshot.frame_id,
            enhanced_frame_id=snapshot.enhanced_frame_id,
            raw_available=True,
            enhancement_available=True,
            metrics=snapshot.metrics,
            visibility_score=snapshot.visibility_score,
            visibility_state=snapshot.visibility_state,
            stream_status="live",
            stream_detail=snapshot.detail,
            width_px=snapshot.width_px,
            height_px=snapshot.height_px,
            measured_fps=snapshot.measured_fps,
            enhancement_status="live",
            enhancement_detail=snapshot.enhancement_detail,
            enhancement_model=snapshot.enhancement_model,
            enhancement_device=snapshot.enhancement_device,
            enhancement_precision=snapshot.enhancement_precision,
            enhancement_latency_ms=snapshot.enhancement_latency_ms,
            enhancement_fps=snapshot.enhancement_fps,
            enhancement_peak_vram_mb=snapshot.enhancement_peak_vram_mb,
            mode=DataMode.LIVE,
        )

    def status_payload(self) -> dict[str, object]:
        return {
            "configured": True,
            "status": "live",
            "source_uri": self.source_uri,
            "raw_available": True,
            "enhancement_available": True,
        }


def test_wifi_camera_reaches_world_and_raw_and_enhanced_endpoints() -> None:
    camera = StaticCameraFeed()
    app = create_app(camera_feed=camera)
    with TestClient(app) as client:
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            world = client.get("/api/world").json()
            if world["camera"]["raw_frame_id"] == "raw-1":
                break
            time.sleep(0.01)
        else:
            raise AssertionError("Live camera state did not reach the FogSen world")

        assert world["mode"] == "SIMULATED"
        assert world["camera"]["mode"] == "LIVE"
        assert world["camera"]["enhancement_available"] is True
        assert world["environment"]["visibility_score"] == 0.44

        status = client.get("/api/camera/status").json()
        assert status["status"] == "live"
        assert status["source_uri"] == "tcp://pi.test:8888"

        raw = client.get("/api/camera/frame?view=raw")
        assert raw.status_code == 200
        assert raw.content == RAW_JPEG
        assert raw.headers["x-fogsen-camera-view"] == "raw"

        enhanced = client.get("/api/camera/frame?view=enhanced")
        assert enhanced.status_code == 200
        assert enhanced.content == ENHANCED_JPEG
        assert enhanced.headers["x-fogsen-camera-view"] == "enhanced"

    assert camera.started is True
    assert camera.stopped is True


def test_enhancement_queue_keeps_the_newest_frame_during_rate_limit() -> None:
    stream = LiveCameraStream(
        "tcp://pi.test:8888",
        enhancer=PassThroughEnhancer(),
        enhancement_max_fps=30,
    )
    first = np.zeros((2, 2, 3), dtype=np.uint8)
    newest = np.ones((2, 2, 3), dtype=np.uint8)
    stream._next_enhancement_at = time.monotonic() + 1.0

    stream._queue_enhancement(first, "raw-1", 1)
    stream._queue_enhancement(newest, "raw-2", 2)

    assert stream._pending_enhancement is not None
    pending_frame, pending_id, pending_timestamp = stream._pending_enhancement
    assert pending_frame is newest
    assert pending_id == "raw-2"
    assert pending_timestamp == 2
