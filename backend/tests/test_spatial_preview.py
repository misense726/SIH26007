import json
import math
from pathlib import Path

from backend.app.simulation.spatial_preview import build_preview


def test_preview_is_explicit_finite_bounded_and_matches_shipped_asset():
    preview = build_preview()
    assert preview["source"] == "SIMULATED"
    assert preview["coordinate_frame"] == "VEHICLE_X_RIGHT_Y_FORWARD_Z_UP"
    assert 10_000 < len(preview["points"]) // 3 <= 36_000
    assert len(preview["points"]) % 3 == 0
    assert all(math.isfinite(value) for value in preview["points"])
    assert len({entity["id"] for entity in preview["entities"]}) == len(preview["entities"])
    asset = Path(__file__).resolve().parents[2] / "frontend/public/spatial-preview.json"
    assert json.loads(asset.read_text(encoding="utf-8")) == preview
    assert build_preview() == preview
