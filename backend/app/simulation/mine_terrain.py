"""Illustrative mine cartography, never an additional sensed or driven route."""

import json
import math
from collections.abc import Iterable

from shapely.geometry import LinearRing, LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points, polylabel

from backend.app.models import GeometryType, MapFeature, MapFeatureType, Point2D


_RIM_ELEVATION_M = 8.0
_FLOOR_ELEVATION_M = -16.0
_MAX_GRADE = 0.12
_ROAD_SPACING_M = 0.75
_BENCH_FILLS = ("#a66b54", "#777b7d")
# Fractions of the available inset, measured independently from the pit edge.
_BENCH_INSETS = (0.07, 0.16, 0.26, 0.35, 0.45, 0.56, 0.67, 0.78, 0.90, 1.0)


def _inset(pit: Polygon, distance: float, floor: Point) -> Polygon:
    """Keep the floor's component if a narrow neck divides during erosion."""
    inset = pit.buffer(-distance, quad_segs=4)
    if isinstance(inset, Polygon):
        return inset
    return next(part for part in inset.geoms if part.covers(floor))


def _aligned_contour(polygon: Polygon, floor: Point) -> tuple[LineString, float]:
    """Align independently buffered rings at the same east-facing floor ray."""
    ring = LineString(orient(polygon, sign=1).exterior.coords)
    min_x, _, max_x, _ = polygon.bounds
    ray = LineString([(floor.x, floor.y), (max_x + max_x - min_x, floor.y)])
    entry = nearest_points(floor, ring.intersection(ray))[1]
    return ring, ring.project(entry)


def _road_path(
    pit: Polygon, floor: Point, radius: float, *, circular: bool = False
) -> list[tuple[float, float]]:
    """Three open contour traverses, with extra traverses for small footprints.

    Rings share an origin and winding before interpolation. Hairpins are sampled
    semicircles in contour-distance/inset space, not chords between distant ring
    vertices. A circular fallback stays in the inscribed floor region when a
    concave pit's inset components separate.
    """
    first_inset = min(1.5, radius * 0.06) if circular else 0.0
    last_inset = radius * 0.68  # Past bench ten, leaving a useful working floor.
    contours = []
    for step in range(41):
        depth = first_inset + (last_inset - first_inset) * step / 40
        if circular:
            polygon = floor.buffer(radius - depth, quad_segs=24)
        else:
            polygon = _inset(pit, depth, floor)
            # Round convex corners without extending beyond the inset footprint.
            corner_radius = min(1.5, radius * 0.08, depth * 0.75)
            if corner_radius:
                polygon = _inset(polygon, corner_radius, floor).buffer(
                    corner_radius, quad_segs=6
                )
        contours.append(_aligned_contour(polygon, floor))

    def sample(depth: float, progress: float) -> tuple[float, float]:
        position = min(40.0, max(0.0, depth * 40))
        lower = min(39, int(position))
        weight = position - lower
        a, start_a = contours[lower]
        b, start_b = contours[lower + 1]
        p = a.interpolate((start_a + progress * a.length) % a.length)
        q = b.interpolate((start_b + progress * b.length) % b.length)
        return p.x + (q.x - p.x) * weight, p.y + (q.y - p.y) * weight

    attachment = Point(sample(0.0, 0.0))
    if circular:
        # Reach the safe inscribed contours along their tangent, not a sharp
        # radial spur. The nearest boundary hit keeps this lead-in inside the pit.
        ray = LineString([
            attachment.coords[0],
            (attachment.x, pit.bounds[1] - radius),
        ])
        attachment = nearest_points(attachment, pit.exterior.intersection(ray))[1]
    span = 0.78
    mean_length = sum(ring.length for ring, _ in contours) / len(contours)
    minimum_length = (_RIM_ELEVATION_M - _FLOOR_ELEVATION_M) / _MAX_GRADE
    passes = max(3, math.ceil(minimum_length * 1.15 / (span * mean_length)))

    while True:
        points = [(attachment.x, attachment.y)]
        # Most descent follows the long traverses; each join has a round U-turn.
        turn_depth = 0.55 / passes
        traverse_depth = (1.0 - (passes - 1) * turn_depth) / passes
        depth = 0.0
        for traverse in range(passes):
            direction = 1 if traverse % 2 == 0 else -1
            origin = 0.0 if direction == 1 else span
            samples = max(24, math.ceil(contours[0][0].length * span / 1.2))
            for step in range(samples + 1):
                t = step / samples
                # Zero lateral velocity at both ends matches the hairpin tangent.
                inset = depth + traverse_depth * t * t * (3 - 2 * t)
                points.append(sample(inset, origin + direction * span * t))
            depth += traverse_depth
            if traverse == passes - 1:
                continue
            turn_radius = turn_depth * radius * 0.5
            ring_length = contours[min(40, round(depth * 40))][0].length
            end = origin + direction * span
            for step in range(1, 25):
                angle = math.pi * step / 24
                points.append(
                    sample(
                        depth + turn_depth * (1 - math.cos(angle)) / 2,
                        end + direction * turn_radius * math.sin(angle) / ring_length,
                    )
                )
            depth += turn_depth

        # Cut the entry corner and any remaining buffer vertices, retaining the
        # exact rim attachment and floor terminus. No disconnected road pieces.
        smooth = [points[0]]
        for a, b in zip(points, points[1:]):
            smooth.extend(
                (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                for t in (0.25, 0.75)
            )
        smooth.append(points[-1])
        length = LineString(smooth).length
        if length >= minimum_length:
            break
        passes = max(passes + 1, math.ceil(passes * minimum_length / length) + 1)

    if not circular and not pit.buffer(1e-8).covers(LineString(smooth)):
        return _road_path(pit, floor, radius, circular=True)

    # Retain curve vertices while bounding every emitted segment's length.
    resampled = [smooth[0]]
    for a, b in zip(smooth, smooth[1:]):
        distance = math.dist(a, b)
        if distance < 1e-10:
            continue
        steps = max(1, math.ceil(distance / _ROAD_SPACING_M))
        resampled.extend(
            (a[0] + (b[0] - a[0]) * step / steps,
             a[1] + (b[1] - a[1]) * step / steps)
            for step in range(1, steps + 1)
        )
    return resampled


def mine_terrain(interiors: Iterable[LinearRing]) -> list[MapFeature]:
    features = []
    for index, ring in enumerate(interiors):
        coordinates = [(float(x), float(y)) for x, y in ring.coords[:-1]]
        if len(coordinates) < 3:
            continue
        pit = Polygon(coordinates)
        if not pit.is_valid or pit.area <= 0:
            continue
        features.append(
            MapFeature(
                feature_id=f"pit-exclusion-{index}",
                feature_type=MapFeatureType.HAZARD_ZONE,
                geometry_type=GeometryType.POLYGON,
                label="Open pit",
                points=[Point2D(x_m=x, y_m=y) for x, y in coordinates],
                properties={
                    "cartography": "pit", "fill": "#ab9278",
                    "elevation_m": _RIM_ELEVATION_M,
                },
            )
        )
        min_x, min_y, max_x, max_y = pit.bounds
        floor = polylabel(pit, tolerance=min(max_x - min_x, max_y - min_y) / 200)
        radius = floor.distance(pit.exterior)
        for level, fraction in enumerate(_BENCH_INSETS, start=1):
            bench = _inset(pit, radius * 0.60 * fraction, floor)
            features.append(
                MapFeature(
                    feature_id=f"bench-{index}-{level}",
                    feature_type=MapFeatureType.TERRAIN,
                    geometry_type=GeometryType.POLYGON,
                    label="Pit benches" if level == 5 else "",
                    points=[Point2D(x_m=x, y_m=y) for x, y in bench.exterior.coords[:-1]],
                    properties={
                        "cartography": "bench",
                        "level": level,
                        "elevation_m": _RIM_ELEVATION_M - level * 2.4,
                        "fill": _BENCH_FILLS[(level - 1) % 2],
                    },
                )
            )
        road = _road_path(pit, floor, radius)
        distances = [0.0]
        for a, b in zip(road, road[1:]):
            distances.append(distances[-1] + math.dist(a, b))
        elevations = [
            _RIM_ELEVATION_M
            + (_FLOOR_ELEVATION_M - _RIM_ELEVATION_M) * distance / distances[-1]
            for distance in distances
        ]
        features.append(
            MapFeature(
                feature_id=f"bench-road-{index}",
                feature_type=MapFeatureType.TERRAIN,
                geometry_type=GeometryType.POLYLINE,
                label="Pit access road",
                points=[Point2D(x_m=x, y_m=y) for x, y in road],
                properties={
                    "cartography": "bench-road",
                    "elevations_m": json.dumps([round(e, 3) for e in elevations]),
                    "width_m": 3.0,
                },
            )
        )
        features.append(
            MapFeature(
                feature_id=f"pit-floor-{index}",
                feature_type=MapFeatureType.TERRAIN,
                geometry_type=GeometryType.POINT,
                label="Excavator working floor",
                points=[Point2D(x_m=road[-1][0], y_m=road[-1][1])],
                properties={"cartography": "pit-floor", "elevation_m": _FLOOR_ELEVATION_M},
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
