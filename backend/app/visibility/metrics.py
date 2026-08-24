from __future__ import annotations

import math

import numpy as np

from backend.app.models import VisibilityMetrics, VisibilityState


def _normalize_image(image: np.ndarray) -> np.ndarray:
    array = np.asarray(image)
    if array.ndim == 3:
        array = array[..., :3].mean(axis=2)
    if array.ndim != 2:
        raise ValueError("Visibility input must be a grayscale or RGB image")
    normalized = array.astype(np.float32, copy=False)
    if normalized.size == 0:
        raise ValueError("Visibility input cannot be empty")
    if normalized.max(initial=0.0) > 1.0:
        normalized = normalized / 255.0
    return np.clip(normalized, 0.0, 1.0)


def visibility_metrics(image: np.ndarray) -> VisibilityMetrics:
    normalized = _normalize_image(image)
    contrast = min(1.0, float(normalized.std()) / 0.24)
    brightness = float(normalized.mean())

    gradient_x = np.abs(np.diff(normalized, axis=1))
    gradient_y = np.abs(np.diff(normalized, axis=0))
    edge_values = np.concatenate((gradient_x.ravel(), gradient_y.ravel()))
    edge_density = min(1.0, float(np.mean(edge_values > 0.07)) * 3.2)

    histogram, _ = np.histogram(normalized, bins=32, range=(0.0, 1.0))
    probabilities = histogram[histogram > 0] / normalized.size
    entropy_raw = -float(np.sum(probabilities * np.log2(probabilities)))
    entropy = min(1.0, entropy_raw / math.log2(32))
    haze_proxy = float(np.clip(1.0 - (0.58 * contrast + 0.42 * edge_density), 0.0, 1.0))
    return VisibilityMetrics(
        contrast=contrast,
        edge_density=edge_density,
        brightness=brightness,
        entropy=entropy,
        haze_proxy=haze_proxy,
    )


def visibility_score(metrics: VisibilityMetrics) -> float:
    exposure_quality = max(0.0, 1.0 - abs(metrics.brightness - 0.52) * 2.1)
    score = (
        0.32 * metrics.contrast
        + 0.28 * metrics.edge_density
        + 0.22 * metrics.entropy
        + 0.18 * exposure_quality
    )
    return float(np.clip(score, 0.0, 1.0))


def visibility_state(score: float) -> VisibilityState:
    if score >= 0.72:
        return VisibilityState.GOOD
    if score >= 0.48:
        return VisibilityState.MODERATE
    if score >= 0.25:
        return VisibilityState.LOW
    return VisibilityState.VERY_LOW


def enhance_visibility(image: np.ndarray) -> np.ndarray:
    """Apply a reversible-display contrast stretch without mutating raw input."""
    normalized = _normalize_image(image).copy()
    low, high = np.percentile(normalized, (2.0, 98.0))
    if high - low < 1e-6:
        return normalized
    stretched = np.clip((normalized - low) / (high - low), 0.0, 1.0)
    return np.power(stretched, 0.9, dtype=np.float32)


def synthetic_visibility_frame(target_score: float, size: int = 72) -> np.ndarray:
    """Create a deterministic camera-like frame for simulator and replay tests."""
    target = float(np.clip(target_score, 0.0, 1.0))
    y, x = np.mgrid[0:size, 0:size]
    checker = ((x // 8 + y // 8) % 2).astype(np.float32)
    road_edges = ((np.abs(x - size * 0.34) < 2) | (np.abs(x - size * 0.66) < 2)).astype(
        np.float32
    )
    clear = np.clip(0.18 + checker * 0.42 + road_edges * 0.4, 0.0, 1.0)
    haze = np.full_like(clear, 0.62)
    return clear * target + haze * (1.0 - target)
