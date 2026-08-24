from __future__ import annotations

import numpy as np

from backend.app.visibility.metrics import (
    enhance_visibility,
    synthetic_visibility_frame,
    visibility_metrics,
    visibility_score,
    visibility_state,
)


def test_clear_frame_scores_above_fog_frame() -> None:
    clear = synthetic_visibility_frame(0.95)
    fog = synthetic_visibility_frame(0.08)
    clear_score = visibility_score(visibility_metrics(clear))
    fog_score = visibility_score(visibility_metrics(fog))
    assert clear_score > fog_score + 0.35
    assert visibility_state(clear_score) in {"GOOD", "MODERATE"}
    assert visibility_state(fog_score) == "VERY_LOW"


def test_enhancement_preserves_raw_frame() -> None:
    raw = synthetic_visibility_frame(0.35)
    original = raw.copy()
    enhanced = enhance_visibility(raw)
    assert np.array_equal(raw, original)
    assert enhanced.shape == raw.shape
    assert enhanced.std() >= raw.std()
