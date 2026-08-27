from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import MethodType

import numpy as np


class DehazeFormerEnhancer:
    """GPU-first wrapper around the official DehazeFormer-MCT mixed-fog model."""

    name = "DehazeFormer-MCT"

    def __init__(
        self,
        model_root: Path,
        *,
        device: str = "auto",
        use_fp16: bool = True,
    ) -> None:
        self._model_root = model_root
        self._weights_path = model_root / "dehazeformer.pth"
        self._requested_device = device
        self._use_fp16 = use_fp16
        self._torch = None
        self._network = None
        self.device = "not loaded"
        self.precision = "not loaded"
        self.peak_vram_mb = 0.0

    def _load(self) -> None:
        if self._network is not None:
            return
        if not self._weights_path.is_file():
            raise FileNotFoundError(f"DehazeFormer weights not found: {self._weights_path}")
        if str(self._model_root) not in sys.path:
            sys.path.insert(0, str(self._model_root))

        torch = importlib.import_module("torch")
        model_module = importlib.import_module("models")
        if self._requested_device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            device = self._requested_device
        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is unavailable to the FogSen container")

        network = model_module.dehazeformer()
        checkpoint = torch.load(
            self._weights_path,
            map_location="cpu",
            weights_only=True,
        )
        network.load_state_dict(checkpoint["state_dict"])

        def get_coord(model, x):
            batch, _, height, width = x.size()
            coord_h, coord_w = torch.meshgrid(
                torch.linspace(-1, 1, height, device=x.device, dtype=x.dtype),
                torch.linspace(-1, 1, width, device=x.device, dtype=x.dtype),
                indexing="ij",
            )
            coord_h = coord_h.unsqueeze(0).unsqueeze(1).repeat(batch, 1, 1, 1)
            coord_w = coord_w.unsqueeze(0).unsqueeze(1).repeat(batch, 1, 1, 1)
            return coord_w.detach(), coord_h.detach()

        network.get_coord = MethodType(get_coord, network)
        network = network.eval().to(device)
        fp16 = device == "cuda" and self._use_fp16
        if fp16:
            network = network.half()
        if device == "cuda":
            torch.backends.cudnn.benchmark = True
            torch.cuda.reset_peak_memory_stats()

        self._torch = torch
        self._network = network
        self.device = device
        self.precision = "FP16" if fp16 else "FP32"

    def enhance(self, bgr_frame: np.ndarray) -> np.ndarray:
        self._load()
        assert self._torch is not None
        assert self._network is not None
        torch = self._torch

        rgb = np.ascontiguousarray(bgr_frame[..., ::-1])
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
        tensor = tensor.to(
            device=self.device,
            dtype=torch.float16 if self.precision == "FP16" else torch.float32,
        )
        tensor = tensor.div_(127.5).sub_(1.0)
        with torch.inference_mode():
            output = self._network(tensor).clamp_(-1, 1).add_(1.0).mul_(127.5)
        output = output[0].permute(1, 2, 0).byte().cpu().numpy()
        if self.device == "cuda":
            self.peak_vram_mb = torch.cuda.max_memory_allocated() / (1024 * 1024)
        return np.ascontiguousarray(output[..., ::-1])
