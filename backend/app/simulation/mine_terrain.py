"""Conceptual mine cartography, separate from sensed obstacles."""

import math

from backend.app.models import GeometryType, MapFeature, MapFeatureType, Point2D


def mine_terrain(interiors) -> list[MapFeature]:
    features = []
    for index, ring in enumerate(interiors):
        points = [Point2D(x_m=x, y_m=y) for x, y in ring.coords[:-1]]
        features.append(
            MapFeature(
                feature_id=f"pit-exclusion-{index}",
                feature_type=MapFeatureType.HAZARD_ZONE,
                geometry_type=GeometryType.POLYGON,
                label="Open pit",
                points=points,
                properties={"cartography": "pit", "fill": "#ab9278"},
            )
        )
        cx = sum(p.x_m for p in points) / len(points)
        cy = sum(p.y_m for p in points) / len(points)
        for level, scale in enumerate([0.86, 0.70, 0.54, 0.39, 0.25]):
            features.append(
                MapFeature(
                    feature_id=f"bench-{index}-{level}",
                    feature_type=MapFeatureType.TERRAIN,
                    geometry_type=GeometryType.POLYGON,
                    label="Pit benches" if level == 2 else "",
                    points=[
                        Point2D(
                            x_m=cx + (p.x_m - cx) * scale, y_m=cy + (p.y_m - cy) * scale
                        )
                        for p in points
                    ],
                    properties={
                        "cartography": "bench",
                        "fill": ["#716b60", "#b2997b", "#77746c", "#aa8164", "#695e52"][
                            level
                        ],
                    },
                )
            )
    for i in range(7):
        features.append(
            MapFeature(
                feature_id=f"contour-{i}",
                feature_type=MapFeatureType.TERRAIN,
                geometry_type=GeometryType.POLYLINE,
                label="",
                points=[
                    Point2D(
                        x_m=4 + (39 + i * 3) * math.cos(t * math.pi / 24),
                        y_m=26 + (35 + i * 2) * math.sin(t * math.pi / 24),
                    )
                    for t in range(49)
                ],
                properties={"cartography": "contour"},
            )
        )
    return features
