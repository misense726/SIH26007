import type { MapFeature, Point2D, WorldState } from "../types";

const SCALE = 10;
const PADDING = 10;
const HEIGHT = 320;

function point(pointValue: Point2D): string {
  return `${PADDING + pointValue.x_m * SCALE},${HEIGHT - PADDING - pointValue.y_m * SCALE}`;
}

function points(feature: MapFeature): string {
  return feature.points.map(point).join(" ");
}

function className(feature: MapFeature): string {
  return `map-feature map-${feature.feature_type.toLowerCase().replace("_", "-")}`;
}

export function TwinMap({ world }: { world: WorldState }) {
  const features = world.reference_map?.features ?? [];

  return (
    <div className="twin-map-wrap">
      <svg
        className="twin-map"
        viewBox="0 0 220 320"
        role="img"
        aria-label="Top-down reference digital twin with live vehicle pose"
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(130,153,143,.12)" />
          </pattern>
          <filter id="vehicle-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="220" height="320" fill="url(#grid)" />

        {features.map((feature) => {
          if (feature.geometry_type === "POLYGON") {
            return <polygon key={feature.feature_id} points={points(feature)} className={className(feature)} />;
          }
          if (feature.geometry_type === "POLYLINE") {
            return <polyline key={feature.feature_id} points={points(feature)} className={className(feature)} />;
          }
          const location = feature.points[0];
          const [cx, cy] = point(location).split(",").map(Number);
          return (
            <g key={feature.feature_id} className={className(feature)}>
              <circle cx={cx} cy={cy} r={feature.feature_type === "STATIC_OBSTACLE" ? 4 : 5} />
              <title>{feature.label}</title>
            </g>
          );
        })}

        {world.vehicles.map((vehicle) => (
          <g
            key={vehicle.vehicle_id}
            className="map-vehicle"
            transform={`translate(${PADDING + vehicle.x_m * SCALE} ${
              HEIGHT - PADDING - vehicle.y_m * SCALE
            }) rotate(${vehicle.heading_deg})`}
            filter="url(#vehicle-glow)"
          >
            <path d="M 0 -9 L 6 7 L 0 5 L -6 7 Z" />
            <circle cx="0" cy="0" r="11" />
          </g>
        ))}
      </svg>
      <div className="map-legend" aria-label="Map legend">
        <span><i className="legend-road" />Road</span>
        <span><i className="legend-route" />Route</span>
        <span><i className="legend-hazard" />Hazard</span>
        <span><i className="legend-vehicle" />Dumper</span>
      </div>
    </div>
  );
}
