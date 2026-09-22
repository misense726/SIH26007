"""Export a deterministic, explicitly simulated point cloud for the empty view.

This visual fixture is never published to WorldState or used by safety logic.
Regenerate with: python -m backend.app.simulation.spatial_preview
"""
from __future__ import annotations

import json
import math
from pathlib import Path


def build_preview() -> dict:
    # Vehicle coordinates: +X right, +Y forward, +Z up, in metres.
    points: list[float] = []

    def point(x: float, y: float, z: float) -> None:
        points.extend((round(x, 3), round(y, 3), round(z, 3)))

    # Scan lines across a road, rising banks, and the far face of a cutting.
    for row in range(190):
        y = -7 + row * 0.23
        for column in range(107):
            x = -12 + column * 0.225
            if abs(x) < 0.8 and abs(y) < 1.7:
                continue
            z = max(0.0, (abs(x) - 5.0) * 0.54)
            z += 0.025 * math.sin(x * 2.1 + y * 0.8)
            point(x, y, max(0, z))
    for row in range(30):
        for column in range(120):
            x, z = -12 + column * 0.2, row * 0.13
            point(x, 36 + 0.13 * math.sin(x * 1.7), z)

    entities = [
        {"id": "preview-truck", "kind": "vehicle", "position": [4.6, 1.5, -11.0],
         "size": [2.8, 3.0, 6.0], "yawRad": 0},
        {"id": "preview-worker", "kind": "object", "position": [-1.5, 0.9, -19.0],
         "size": [0.65, 1.8, 0.65], "yawRad": 0},
    ]
    # Surfaces of the illustrative objects, sampled on the same fixed lattice.
    for entity in entities:
        if entity["kind"] == "vehicle":
            continue  # The viewer renders vehicles as solid truck models.
        cx, cy, cz = entity["position"]
        sx, sy, sz = entity["size"]
        for row in range(max(1, int(sy / 0.1)) + 1):
            z = row * 0.1
            for column in range(max(1, int(sz / 0.13)) + 1):
                y = -cz - sz / 2 + column * 0.13
                point(cx - sx / 2, y, z)
                point(cx + sx / 2, y, z)
            for column in range(max(1, int(sx / 0.13)) + 1):
                x = cx - sx / 2 + column * 0.13
                point(x, -cz - sz / 2, z)
                point(x, -cz + sz / 2, z)
    return {"source": "SIMULATED", "coordinate_frame": "VEHICLE_X_RIGHT_Y_FORWARD_Z_UP",
            "points": points, "entities": entities}


if __name__ == "__main__":
    output = Path(__file__).resolve().parents[3] / "frontend/public/spatial-preview.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build_preview(), separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output}")
