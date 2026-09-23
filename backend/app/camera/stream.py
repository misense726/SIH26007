from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass, field, replace
from typing import Literal, Protocol

import numpy as np

from backend.app.models import CameraState, DataMode, VisibilityMetrics, VisibilityState
from backend.app.models.telemetry import now_ms
from backend.app.visibility.metrics import visibility_metrics, visibility_score, visibility_state


CameraStreamStatus = Literal["disabled", "connecting", "live", "stale", "error"]
EnhancementStatus = Literal["disabled", "loading", "live", "stale", "error"]


class FrameEnhancer(Protocol):
    name: str
    device: str
    precision: str
    peak_vram_mb: float

    def enhance(self, bgr_frame: np.ndarray) -> np.ndarray: ...


@dataclass(frozen=True, slots=True)
class CameraFrameSnapshot:
    timestamp_ms: int = 0
    frame_id: str | None = None
    raw_jpeg: bytes | None = None
    enhanced_timestamp_ms: int = 0
    enhanced_frame_id: str | None = None
    enhanced_jpeg: bytes | None = None
    metrics: VisibilityMetrics = field(default_factory=VisibilityMetrics)
    visibility_score: float | None = None
    visibility_state: VisibilityState | None = None
    status: CameraStreamStatus = "connecting"
    detail: str | None = None
    width_px: int | None = None
    height_px: int | None = None
    measured_fps: float = 0.0
    enhancement_status: EnhancementStatus = "disabled"
    enhancement_detail: str | None = None
    enhancement_model: str | None = None
    enhancement_device: str | None = None
    enhancement_precision: str | None = None
    enhancement_latency_ms: float | None = None
    enhancement_fps: float = 0.0
    enhancement_peak_vram_mb: float = 0.0
    ir_timestamp_ms: int = 0
    ir_frame_id: str | None = None
    ir_jpeg: bytes | None = None
    ir_status: EnhancementStatus = "disabled"
    ir_detail: str | None = None
    ir_model: str | None = None
    ir_device: str | None = None
    ir_precision: str | None = None
    ir_latency_ms: float | None = None
    ir_fps: float = 0.0
    ir_peak_vram_mb: float = 0.0


class CameraFeed(Protocol):
    source_uri: str

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    def snapshot(self) -> CameraFrameSnapshot: ...

    def camera_state(self) -> CameraState: ...

    def status_payload(self) -> dict[str, object]: ...


class LiveCameraStream:
    """Drain one H.264 network source and share its latest decoded JPEG frame."""

    def __init__(
        self,
        source_uri: str,
        *,
        stale_ms: int = 1_500,
        reconnect_ms: int = 1_000,
        open_timeout_ms: int = 15_000,
        read_timeout_ms: int = 5_000,
        jpeg_quality: int = 88,
        metrics_interval_ms: int = 500,
        enhancer: FrameEnhancer | None = None,
        enhancement_max_fps: float = 30.0,
        ir_enhancer: FrameEnhancer | None = None,
        ir_max_fps: float = 30.0,
        rotation: int = 0,
    ) -> None:
        self.source_uri = source_uri
        self._rotation = rotation
        self._stale_ms = stale_ms
        self._reconnect_s = reconnect_ms / 1_000.0
        self._open_timeout_ms = open_timeout_ms
        self._read_timeout_ms = read_timeout_ms
        self._jpeg_quality = jpeg_quality
        self._metrics_interval_s = metrics_interval_ms / 1_000.0
        self._enhancer = enhancer
        self._enhancement_interval_s = 1.0 / enhancement_max_fps
        self._ir_enhancer = ir_enhancer
        self._ir_interval_s = 1.0 / ir_max_fps
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._enhancement_thread: threading.Thread | None = None
        self._ir_thread: threading.Thread | None = None
        self._capture = None
        self._enhancement_condition = threading.Condition()
        self._pending_enhancement: tuple[np.ndarray, str, int] | None = None
        self._next_enhancement_at = 0.0
        self._ir_condition = threading.Condition()
        self._pending_ir: tuple[np.ndarray, str, int] | None = None
        self._next_ir_at = 0.0
        self._frame_sequence = 0
        self._snapshot = CameraFrameSnapshot(
            status="connecting",
            detail=f"Connecting to the Pi camera at {source_uri}",
            enhancement_status="loading" if enhancer is not None else "disabled",
            enhancement_detail=(
                f"Loading {enhancer.name}" if enhancer is not None else "ML enhancement is disabled"
            ),
            enhancement_model=enhancer.name if enhancer is not None else None,
            ir_status="loading" if ir_enhancer is not None else "disabled",
            ir_detail=(
                f"Loading {ir_enhancer.name}" if ir_enhancer is not None else "IR enhancement is disabled"
            ),
            ir_model=ir_enhancer.name if ir_enhancer is not None else None,
        )

    async def start(self) -> None:
        if self._thread is not None:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="fogsen-wifi-camera",
            daemon=True,
        )
        self._thread.start()
        if self._enhancer is not None:
            self._enhancement_thread = threading.Thread(
                target=self._run_enhancer,
                name="fogsen-dehazeformer",
                daemon=True,
            )
            self._enhancement_thread.start()
        if self._ir_enhancer is not None:
            self._ir_thread = threading.Thread(
                target=self._run_ir,
                name="fogsen-ir-enhancer",
                daemon=True,
            )
            self._ir_thread.start()

    async def stop(self) -> None:
        thread, self._thread = self._thread, None
        enhancement_thread, self._enhancement_thread = self._enhancement_thread, None
        ir_thread, self._ir_thread = self._ir_thread, None
        if thread is None:
            return
        self._stop_event.set()
        with self._enhancement_condition:
            self._enhancement_condition.notify_all()
        with self._ir_condition:
            self._ir_condition.notify_all()
        capture = self._capture
        if capture is not None:
            capture.release()
        await asyncio.to_thread(thread.join, 4.0)
        if enhancement_thread is not None:
            await asyncio.to_thread(enhancement_thread.join, 4.0)
        if ir_thread is not None:
            await asyncio.to_thread(ir_thread.join, 4.0)
        self._set_status("disabled", "Camera ingest stopped")

    def snapshot(self) -> CameraFrameSnapshot:
        with self._lock:
            snapshot = self._snapshot
        current_ms = now_ms()
        if (
            snapshot.raw_jpeg is not None
            and current_ms - snapshot.timestamp_ms > self._stale_ms
        ):
            return replace(
                snapshot,
                raw_jpeg=None,
                enhanced_jpeg=None,
                ir_jpeg=None,
                status="stale",
                detail=f"No Pi camera frame received for {self._stale_ms} ms",
                measured_fps=0.0,
                enhancement_status=(
                    "stale" if self._enhancer is not None else snapshot.enhancement_status
                ),
                enhancement_fps=0.0,
                ir_status=(
                    "stale" if self._ir_enhancer is not None else snapshot.ir_status
                ),
                ir_fps=0.0,
            )
        if (
            snapshot.enhanced_jpeg is not None
            and current_ms - snapshot.enhanced_timestamp_ms > self._stale_ms * 2
        ):
            snapshot = replace(
                snapshot,
                enhanced_jpeg=None,
                enhancement_status="stale",
                enhancement_detail="The latest ML-enhanced frame is stale",
                enhancement_fps=0.0,
            )
        if (
            snapshot.ir_jpeg is not None
            and current_ms - snapshot.ir_timestamp_ms > self._stale_ms * 2
        ):
            snapshot = replace(
                snapshot,
                ir_jpeg=None,
                ir_status="stale",
                ir_detail="The latest IR frame is stale",
                ir_fps=0.0,
            )
        return snapshot

    def camera_state(self) -> CameraState:
        snapshot = self.snapshot()
        available = snapshot.raw_jpeg is not None
        return CameraState(
            timestamp_ms=snapshot.timestamp_ms,
            raw_frame_id=snapshot.frame_id,
            enhanced_frame_id=snapshot.enhanced_frame_id,
            raw_available=available,
            enhancement_available=snapshot.enhanced_jpeg is not None,
            metrics=snapshot.metrics,
            visibility_score=snapshot.visibility_score if available else None,
            visibility_state=snapshot.visibility_state if available else None,
            stream_status=snapshot.status,
            stream_detail=snapshot.detail,
            width_px=snapshot.width_px,
            height_px=snapshot.height_px,
            measured_fps=snapshot.measured_fps if available else 0.0,
            enhancement_status=snapshot.enhancement_status,
            enhancement_detail=snapshot.enhancement_detail,
            enhancement_model=snapshot.enhancement_model,
            enhancement_device=snapshot.enhancement_device,
            enhancement_precision=snapshot.enhancement_precision,
            enhancement_latency_ms=snapshot.enhancement_latency_ms,
            enhancement_fps=snapshot.enhancement_fps,
            enhancement_peak_vram_mb=snapshot.enhancement_peak_vram_mb,
            ir_available=snapshot.ir_jpeg is not None,
            ir_frame_id=snapshot.ir_frame_id,
            ir_status=snapshot.ir_status,
            ir_detail=snapshot.ir_detail,
            ir_model=snapshot.ir_model,
            ir_device=snapshot.ir_device,
            ir_precision=snapshot.ir_precision,
            ir_latency_ms=snapshot.ir_latency_ms,
            ir_fps=snapshot.ir_fps,
            ir_peak_vram_mb=snapshot.ir_peak_vram_mb,
            mode=DataMode.LIVE,
        )

    def status_payload(self) -> dict[str, object]:
        snapshot = self.snapshot()
        return {
            "configured": True,
            "status": snapshot.status,
            "detail": snapshot.detail,
            "source_uri": self.source_uri,
            "last_frame_ms": snapshot.timestamp_ms or None,
            "frame_id": snapshot.frame_id,
            "raw_available": snapshot.raw_jpeg is not None,
            "width_px": snapshot.width_px,
            "height_px": snapshot.height_px,
            "measured_fps": round(snapshot.measured_fps, 2),
            "visibility_score": snapshot.visibility_score,
            "visibility_state": snapshot.visibility_state,
            "enhancement_available": snapshot.enhanced_jpeg is not None,
            "enhancement_status": snapshot.enhancement_status,
            "enhancement_detail": snapshot.enhancement_detail,
            "enhancement_model": snapshot.enhancement_model,
            "enhancement_device": snapshot.enhancement_device,
            "enhancement_precision": snapshot.enhancement_precision,
            "enhancement_latency_ms": snapshot.enhancement_latency_ms,
            "enhancement_fps": round(snapshot.enhancement_fps, 2),
            "enhancement_peak_vram_mb": round(snapshot.enhancement_peak_vram_mb, 1),
            "ir_available": snapshot.ir_jpeg is not None,
            "ir_status": snapshot.ir_status,
            "ir_detail": snapshot.ir_detail,
            "ir_model": snapshot.ir_model,
            "ir_device": snapshot.ir_device,
            "ir_precision": snapshot.ir_precision,
            "ir_latency_ms": snapshot.ir_latency_ms,
            "ir_fps": round(snapshot.ir_fps, 2),
            "ir_peak_vram_mb": round(snapshot.ir_peak_vram_mb, 1),
        }

    def _queue_enhancement(self, frame: np.ndarray, frame_id: str, timestamp_ms: int) -> None:
        if self._enhancer is None:
            return
        with self._enhancement_condition:
            # Keep only the newest frame. Rate limiting belongs in the worker so
            # source-frame jitter cannot accidentally halve the output rate.
            self._pending_enhancement = (frame, frame_id, timestamp_ms)
            self._enhancement_condition.notify()

    def _run_enhancer(self) -> None:
        import cv2

        assert self._enhancer is not None
        last_completed_at: float | None = None
        enhancement_fps = 0.0
        while not self._stop_event.is_set():
            with self._enhancement_condition:
                while self._pending_enhancement is None and not self._stop_event.is_set():
                    self._enhancement_condition.wait(timeout=0.5)
                if self._stop_event.is_set():
                    return
                remaining = self._next_enhancement_at - time.monotonic()
                if remaining > 0:
                    # New arrivals can replace the pending frame while the worker
                    # waits, so inference starts with the freshest image.
                    self._enhancement_condition.wait(timeout=remaining)
                    continue
                pending, self._pending_enhancement = self._pending_enhancement, None
                self._next_enhancement_at = time.monotonic() + self._enhancement_interval_s
            if pending is None:
                continue
            frame, source_frame_id, source_timestamp_ms = pending
            started = time.monotonic()
            try:
                enhanced = self._enhancer.enhance(frame)
                encoded, jpeg = cv2.imencode(
                    ".jpg",
                    enhanced,
                    [int(cv2.IMWRITE_JPEG_QUALITY), self._jpeg_quality],
                )
                if not encoded:
                    raise RuntimeError("OpenCV could not encode the enhanced frame")
            except Exception as exc:
                with self._lock:
                    self._snapshot = replace(
                        self._snapshot,
                        enhanced_jpeg=None,
                        enhancement_status="error",
                        enhancement_detail=f"{type(exc).__name__}: {exc}",
                        enhancement_device=self._enhancer.device,
                        enhancement_precision=self._enhancer.precision,
                    )
                return

            completed = time.monotonic()
            latency_ms = (completed - started) * 1_000.0
            if last_completed_at is not None and completed > last_completed_at:
                instant_fps = 1.0 / (completed - last_completed_at)
                enhancement_fps = (
                    instant_fps
                    if enhancement_fps == 0.0
                    else enhancement_fps * 0.8 + instant_fps * 0.2
                )
            last_completed_at = completed
            with self._lock:
                self._snapshot = replace(
                    self._snapshot,
                    enhanced_timestamp_ms=source_timestamp_ms,
                    enhanced_frame_id=f"dehazed-{source_frame_id}",
                    enhanced_jpeg=jpeg.tobytes(),
                    enhancement_status="live",
                    enhancement_detail="ML dehazing is running on the laptop GPU",
                    enhancement_model=self._enhancer.name,
                    enhancement_device=self._enhancer.device,
                    enhancement_precision=self._enhancer.precision,
                    enhancement_latency_ms=latency_ms,
                    enhancement_fps=enhancement_fps,
                    enhancement_peak_vram_mb=self._enhancer.peak_vram_mb,
                )

    def _queue_ir(self, frame: np.ndarray, frame_id: str, timestamp_ms: int) -> None:
        if self._ir_enhancer is None:
            return
        with self._ir_condition:
            self._pending_ir = (frame, frame_id, timestamp_ms)
            self._ir_condition.notify()

    def _run_ir(self) -> None:
        import cv2

        assert self._ir_enhancer is not None
        last_completed_at: float | None = None
        ir_fps = 0.0
        while not self._stop_event.is_set():
            with self._ir_condition:
                while self._pending_ir is None and not self._stop_event.is_set():
                    self._ir_condition.wait(timeout=0.5)
                if self._stop_event.is_set():
                    return
                remaining = self._next_ir_at - time.monotonic()
                if remaining > 0:
                    self._ir_condition.wait(timeout=remaining)
                    continue
                pending, self._pending_ir = self._pending_ir, None
                self._next_ir_at = time.monotonic() + self._ir_interval_s
            if pending is None:
                continue
            frame, source_frame_id, source_timestamp_ms = pending
            started = time.monotonic()
            try:
                ir_frame = self._ir_enhancer.enhance(frame)
                encoded, jpeg = cv2.imencode(
                    ".jpg",
                    ir_frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), self._jpeg_quality],
                )
                if not encoded:
                    raise RuntimeError("OpenCV could not encode the IR frame")
            except Exception as exc:
                with self._lock:
                    self._snapshot = replace(
                        self._snapshot,
                        ir_jpeg=None,
                        ir_status="error",
                        ir_detail=f"{type(exc).__name__}: {exc}",
                        ir_device=self._ir_enhancer.device,
                        ir_precision=self._ir_enhancer.precision,
                    )
                return

            completed = time.monotonic()
            latency_ms = (completed - started) * 1_000.0
            if last_completed_at is not None and completed > last_completed_at:
                instant_fps = 1.0 / (completed - last_completed_at)
                ir_fps = (
                    instant_fps
                    if ir_fps == 0.0
                    else ir_fps * 0.8 + instant_fps * 0.2
                )
            last_completed_at = completed
            with self._lock:
                self._snapshot = replace(
                    self._snapshot,
                    ir_timestamp_ms=source_timestamp_ms,
                    ir_frame_id=f"ir-{source_frame_id}",
                    ir_jpeg=jpeg.tobytes(),
                    ir_status="live",
                    ir_detail="IR enhancement is running",
                    ir_model=self._ir_enhancer.name,
                    ir_device=self._ir_enhancer.device,
                    ir_precision=self._ir_enhancer.precision,
                    ir_latency_ms=latency_ms,
                    ir_fps=ir_fps,
                    ir_peak_vram_mb=self._ir_enhancer.peak_vram_mb,
                )

    def _set_status(self, status: CameraStreamStatus, detail: str) -> None:
        with self._lock:
            self._snapshot = replace(self._snapshot, status=status, detail=detail)

    def _open_capture(self, cv2):
        parameters: list[int] = []
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            parameters.extend([cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, self._open_timeout_ms])
        if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            parameters.extend([cv2.CAP_PROP_READ_TIMEOUT_MSEC, self._read_timeout_ms])
        try:
            return cv2.VideoCapture(self.source_uri, cv2.CAP_FFMPEG, parameters)
        except (TypeError, cv2.error):
            return cv2.VideoCapture(self.source_uri, cv2.CAP_FFMPEG)

    def _run(self) -> None:
        try:
            import cv2
        except ImportError as exc:
            self._set_status("error", f"OpenCV camera support is unavailable: {exc}")
            return

        fps_window_started = time.monotonic()
        fps_window_frames = 0
        last_metrics_at = 0.0
        measured_fps = 0.0
        metrics = VisibilityMetrics()
        score: float | None = None

        while not self._stop_event.is_set():
            self._set_status(
                "connecting",
                f"Connecting to the Pi camera at {self.source_uri}",
            )
            capture = self._open_capture(cv2)
            self._capture = capture
            if not capture.isOpened():
                capture.release()
                self._capture = None
                self._set_status(
                    "error",
                    f"Could not open the Pi camera at {self.source_uri}",
                )
                self._stop_event.wait(self._reconnect_s)
                continue

            # A reconnect delay is not part of the source frame rate.
            fps_window_started = time.monotonic()
            fps_window_frames = 0
            measured_fps = 0.0

            while not self._stop_event.is_set():
                ok, frame = capture.read()
                if not ok or frame is None:
                    self._set_status("error", "The Pi camera stream disconnected")
                    break

                if self._rotation == 180:
                    frame = cv2.rotate(frame, cv2.ROTATE_180)
                elif self._rotation == 90:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
                elif self._rotation == 270:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)

                captured_at = time.monotonic()
                timestamp_ms = now_ms()
                height_px, width_px = frame.shape[:2]
                fps_window_frames += 1
                fps_window_elapsed = captured_at - fps_window_started
                if fps_window_elapsed >= 2.0:
                    measured_fps = fps_window_frames / fps_window_elapsed
                    fps_window_started = captured_at
                    fps_window_frames = 0

                if score is None or captured_at - last_metrics_at >= self._metrics_interval_s:
                    scale = min(1.0, 320.0 / max(1, width_px))
                    sample = frame
                    if scale < 1.0:
                        sample = cv2.resize(
                            frame,
                            (max(1, round(width_px * scale)), max(1, round(height_px * scale))),
                            interpolation=cv2.INTER_AREA,
                        )
                    metrics = visibility_metrics(sample)
                    score = visibility_score(metrics)
                    last_metrics_at = captured_at

                encoded, jpeg = cv2.imencode(
                    ".jpg",
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), self._jpeg_quality],
                )
                if not encoded:
                    continue

                self._frame_sequence += 1
                frame_id = f"pi-camera-{timestamp_ms}-{self._frame_sequence}"
                with self._lock:
                    self._snapshot = CameraFrameSnapshot(
                        timestamp_ms=timestamp_ms,
                        frame_id=frame_id,
                        raw_jpeg=jpeg.tobytes(),
                        metrics=metrics,
                        visibility_score=score,
                        visibility_state=visibility_state(score),
                        status="live",
                        detail="Receiving the Raspberry Pi camera over Wi-Fi",
                        width_px=width_px,
                        height_px=height_px,
                        measured_fps=measured_fps,
                        enhanced_timestamp_ms=self._snapshot.enhanced_timestamp_ms,
                        enhanced_frame_id=self._snapshot.enhanced_frame_id,
                        enhanced_jpeg=self._snapshot.enhanced_jpeg,
                        enhancement_status=self._snapshot.enhancement_status,
                        enhancement_detail=self._snapshot.enhancement_detail,
                        enhancement_model=self._snapshot.enhancement_model,
                        enhancement_device=self._snapshot.enhancement_device,
                        enhancement_precision=self._snapshot.enhancement_precision,
                        enhancement_latency_ms=self._snapshot.enhancement_latency_ms,
                        enhancement_fps=self._snapshot.enhancement_fps,
                        enhancement_peak_vram_mb=self._snapshot.enhancement_peak_vram_mb,
                        ir_timestamp_ms=self._snapshot.ir_timestamp_ms,
                        ir_frame_id=self._snapshot.ir_frame_id,
                        ir_jpeg=self._snapshot.ir_jpeg,
                        ir_status=self._snapshot.ir_status,
                        ir_detail=self._snapshot.ir_detail,
                        ir_model=self._snapshot.ir_model,
                        ir_device=self._snapshot.ir_device,
                        ir_precision=self._snapshot.ir_precision,
                        ir_latency_ms=self._snapshot.ir_latency_ms,
                        ir_fps=self._snapshot.ir_fps,
                        ir_peak_vram_mb=self._snapshot.ir_peak_vram_mb,
                    )
                self._queue_enhancement(frame, frame_id, timestamp_ms)
                self._queue_ir(frame, frame_id, timestamp_ms)

            capture.release()
            self._capture = None
            if not self._stop_event.is_set():
                self._stop_event.wait(self._reconnect_s)
