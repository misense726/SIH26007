"""Connect the rim circuit to the existing graded pit access road."""

import math
import json

from shapely.geometry import LineString, Point, Polygon

from backend.app.models import GeometryType, MapFeature, MapFeatureType, Point2D
from backend.app.twin.route import PolylineRoute


def connect_pit(haul) -> None:
    ramp = next((f for f in haul.reference_map.features
                 if f.properties.get("cartography") == "bench-road"), None)
    if ramp is None:
        return
    rim = list(haul.route.points)
    lane = 1.0
    ramp.properties["width_m"] = 7.2
    points = ramp.points

    center = LineString([(p.x_m, p.y_m) for p in points])
    def lane_points(side):
        curve = center.offset_curve(side, quad_segs=8).simplify(0.05)
        return [Point2D(x_m=x, y_m=y) for x, y in curve.coords]

    up = list(reversed(lane_points(lane)))
    down = lane_points(-lane)
    junction = min(range(len(rim) - 1), key=lambda i:
                   math.hypot(rim[i].x_m - points[0].x_m, rim[i].y_m - points[0].y_m))
    approach = up + [rim[junction]]
    prefix = PolylineRoute(approach).total_length_m
    rim_origin = sum(haul.route.segment_lengths[:junction])
    rim_length = haul.route.total_length_m
    floor = points[-1]
    a = points[-2]
    heading = math.atan2(floor.y_m - a.y_m, floor.x_m - a.x_m)
    # Join the descending and ascending lanes around the loading pad.
    turn = [Point2D(x_m=floor.x_m + lane * math.cos(heading - math.pi / 2 + math.pi * i / 16),
                    y_m=floor.y_m + lane * math.sin(heading - math.pi / 2 + math.pi * i / 16))
            for i in range(1, 16)]
    route_points = approach + rim[junction + 1:] + rim[1:junction + 1] + down + turn + [up[0]]
    haul.route = PolylineRoute(route_points, corner_blend_m=haul.config.get("corner_blend_m", 1.8))
    rim_height = 8.0 + rim[junction].y_m * 0.009 + rim[junction].x_m * 0.004
    def ramp_height(p):
        return rim_height - (rim_height + 16.0) * center.project(Point(p.x_m, p.y_m)) / center.length
    rim_part = rim[junction + 1:] + rim[1:junction + 1]
    haul.road_elevations = ([ramp_height(p) for p in up] + [rim_height] +
                            [8.0 + p.y_m * 0.009 + p.x_m * 0.004 for p in rim_part] +
                            [ramp_height(p) for p in down] + [-16.0] * (len(turn) + 1))
    haul.dump_distance = prefix + (haul.dump_distance - rim_origin) % rim_length
    for key in ("obstacle_distance_m", "lead_distance_m", "peer_start_distance_m"):
        haul.config[key] = prefix + (haul.config[key] - rim_origin) % rim_length
    for feature in haul.reference_map.features:
        if feature.feature_type in {MapFeatureType.ROUTE, MapFeatureType.CENTERLINE}:
            feature.points = route_points
            feature.properties["elevations_m"] = json.dumps(haul.road_elevations)
            if feature.feature_type is MapFeatureType.ROUTE:
                feature.properties["cartography"] = "haul-grade"
                feature.properties["width_m"] = 3.2
        elif feature.feature_id == "mine":
            feature.points = [up[0]]
            feature.properties["cartography"] = "pit-loading"

    access = LineString([(p.x_m, p.y_m) for p in approach]).buffer(3.6, quad_segs=4)
    berms = []
    for feature in haul.reference_map.features:
        if feature.feature_type is not MapFeatureType.BERM:
            berms.append(feature)
            continue
        remaining = LineString([(p.x_m, p.y_m) for p in feature.points]).difference(access)
        parts = list(remaining.geoms) if hasattr(remaining, "geoms") else [remaining]
        for i, part in enumerate(parts):
            if not part.is_empty:
                berms.append(feature.model_copy(update={
                    "feature_id": f"{feature.feature_id}-{i}",
                    "points": [Point2D(x_m=x, y_m=y) for x, y in part.coords],
                }))
    haul.reference_map.features = berms
    haul.reference_map.features.append(MapFeature(
        feature_id="pit-access-road", feature_type=MapFeatureType.ROAD,
        geometry_type=GeometryType.POLYGON, label="Pit haul road",
        points=[Point2D(x_m=x, y_m=y) for x, y in access.exterior.coords[:-1]],
        properties={"cartography": "graded-access"},
    ))
    # Keep the pit illustration intact, but exclude the actual road from hazards.
    hazards = []
    for feature in haul.reference_map.features:
        if feature.properties.get("cartography") != "pit":
            continue
        feature.feature_type = MapFeatureType.TERRAIN
        remaining = Polygon([(p.x_m, p.y_m) for p in feature.points]).difference(access)
        parts = list(remaining.geoms) if hasattr(remaining, "geoms") else [remaining]
        for i, part in enumerate(parts):
            if part.is_empty or not isinstance(part, Polygon):
                continue
            hazards.append(MapFeature(
                feature_id=f"{feature.feature_id}-hazard-{i}",
                feature_type=MapFeatureType.HAZARD_ZONE,
                geometry_type=GeometryType.POLYGON, label="Pit exclusion",
                points=[Point2D(x_m=x, y_m=y) for x, y in part.exterior.coords[:-1]],
            ))
    haul.reference_map.features.extend(hazards)
