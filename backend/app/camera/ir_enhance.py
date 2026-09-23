from __future__ import annotations

import importlib
import numpy as np


class IREnhancer:
    """Convert an RGB camera frame into an infrared (thermal-palette) image.

    Hardware Acceleration:
    - If ``device="cuda"`` (or ``device="auto"`` with CUDA available), inference
      runs on the NVIDIA GPU via PyTorch CUDA tensors with FP16/FP32 acceleration
      and VRAM tracking.
    - If ``device="cpu"``, it falls back to an OpenCV CPU pipeline (CLAHE + colourmap).

    Conforms to the ``FrameEnhancer`` protocol.
    """

    name: str = "IR"

    # Supported colourmap names -> OpenCV constants
    _COLOURMAP_NAMES: dict[str, int] = {}

    def __init__(
        self,
        *,
        device: str = "auto",
        use_fp16: bool = True,
        colormap: str = "GRAY",
        clahe_clip: float = 3.0,
        clahe_grid: tuple[int, int] = (8, 8),
    ) -> None:
        self._requested_device = device
        self._use_fp16 = use_fp16
        self._colormap_name = colormap.upper()
        self._is_monochrome = self._colormap_name in {
            "GRAY",
            "GREY",
            "BW",
            "MONO",
            "MONOCHROME",
            "BLACKANDWHITE",
            "IR",
        }
        self._clahe_clip = clahe_clip
        self._clahe_grid = clahe_grid
        self._torch = None
        self._gpu_lut = None
        self._gpu_weights = None
        self._clahe = None
        self._colormap_id: int | None = None
        self.device = "not loaded"
        self.precision = "not loaded"
        self.peak_vram_mb = 0.0

    def _ensure_colormaps(self, cv2) -> None:
        if not IREnhancer._COLOURMAP_NAMES:
            IREnhancer._COLOURMAP_NAMES = {
                "INFERNO": cv2.COLORMAP_INFERNO,
                "HOT": cv2.COLORMAP_HOT,
                "JET": cv2.COLORMAP_JET,
                "MAGMA": cv2.COLORMAP_MAGMA,
                "PLASMA": cv2.COLORMAP_PLASMA,
                "BONE": cv2.COLORMAP_BONE,
                "OCEAN": cv2.COLORMAP_OCEAN,
                "TURBO": cv2.COLORMAP_TURBO,
            }
        if self._colormap_id is None:
            self._colormap_id = IREnhancer._COLOURMAP_NAMES.get(
                self._colormap_name,
                cv2.COLORMAP_INFERNO,
            )

    def _load(self) -> None:
        if self.device != "not loaded":
            return

        import cv2
        self._ensure_colormaps(cv2)

        torch = None
        device = self._requested_device
        if device in {"auto", "cuda"}:
            try:
                torch = importlib.import_module("torch")
                if device == "auto":
                    device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                if device == "cuda":
                    raise RuntimeError("PyTorch is required for CUDA-accelerated IR enhancement")
                device = "cpu"

        if device == "cuda":
            if torch is None or not torch.cuda.is_available():
                raise RuntimeError("CUDA was requested for IR enhancement but is unavailable")

            fp16 = self._use_fp16
            self._torch = torch
            self.device = "cuda"
            self.precision = "FP16" if fp16 else "FP32"

            # Precompute 256-entry BGR colourmap LUT on GPU
            if self._is_monochrome:
                lut_base = np.arange(256, dtype=np.uint8)
                lut_bgr = np.stack([lut_base, lut_base, lut_base], axis=-1)
                lut_bgr = np.ascontiguousarray(lut_bgr)
            else:
                lut_base = np.arange(256, dtype=np.uint8).reshape(256, 1)
                lut_bgr = cv2.applyColorMap(lut_base, self._colormap_id)
                lut_bgr = np.ascontiguousarray(lut_bgr.reshape(256, 3))

            self._gpu_lut = torch.from_numpy(lut_bgr).to(
                device="cuda",
                dtype=torch.uint8,
                non_blocking=True,
            )
            # Precompute luminance weights tensor [B, G, R] for ITU-R BT.601
            self._gpu_weights = torch.tensor(
                [0.114, 0.587, 0.299],
                device="cuda",
                dtype=torch.float16 if fp16 else torch.float32,
            )
            torch.backends.cudnn.benchmark = True
            torch.cuda.reset_peak_memory_stats()
        else:
            self.device = "cpu"
            self.precision = "N/A"
            self._clahe = cv2.createCLAHE(
                clipLimit=self._clahe_clip,
                tileGridSize=self._clahe_grid,
            )

    def enhance(self, bgr_frame: np.ndarray) -> np.ndarray:
        self._load()

        if self.device == "cuda":
            assert self._torch is not None
            assert self._gpu_lut is not None
            assert self._gpu_weights is not None
            torch = self._torch

            dtype = torch.float16 if self.precision == "FP16" else torch.float32
            tensor = torch.from_numpy(bgr_frame).to(
                device="cuda",
                dtype=dtype,
                non_blocking=True,
            )

            # 1. Luminance conversion on GPU (ITU-R BT.601 in BGR channel order)
            lum = (tensor * self._gpu_weights).sum(dim=-1)

            # 2. GPU dynamic thermal radiance normalization and non-linear emissive curve
            min_val = lum.amin()
            max_val = lum.amax()
            normalized = (lum - min_val) / (max_val - min_val + 1e-5)

            thermal_curve = torch.sigmoid((normalized - 0.42) * 7.5)
            blended = 0.4 * normalized + 0.6 * thermal_curve

            indices = (blended * 255.0).clamp_(0, 255).to(torch.long)

            # 3. GPU colourmap LUT gather
            with torch.inference_mode():
                ir_gpu = self._gpu_lut[indices]

            ir_bgr = ir_gpu.cpu().numpy()
            self.peak_vram_mb = torch.cuda.max_memory_allocated() / (1024 * 1024)
            return np.ascontiguousarray(ir_bgr)

        # CPU Fallback via OpenCV
        import cv2
        assert self._clahe is not None

        grey = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2GRAY)
        grey = self._clahe.apply(grey)
        if self._is_monochrome:
            return cv2.cvtColor(grey, cv2.COLOR_GRAY2BGR)
        assert self._colormap_id is not None
        ir_bgr = cv2.applyColorMap(grey, self._colormap_id)
        return ir_bgr
