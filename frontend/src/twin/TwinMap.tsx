import type { MapFeature, Point2D, WorldState } from "../types";

const SCALE = 10;
const PADDING = 14;
const HEIGHT = 320;
const WIDTH = 240;

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
  const primaryVehicle = world.vehicles[0] || {
    vehicle_id: "PRIMARY-DUMPER",
    x_m: 0,
    y_m: 0,
    heading_deg: 0,
    speed_mps: 0,
  };
  const activePeers = world.v2x?.active_peers ?? [];

  return (
    <div className="twin-map-wrap">
      <svg
        className="twin-map"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Top-down reference digital twin with live fleet drivers"
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path className="map-grid-line" d="M 20 0 L 0 0 0 20" fill="none" />
          </pattern>
          <filter id="vehicle-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="peer-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Tactical Grid Background */}
        <rect width={WIDTH} height={HEIGHT} fill="url(#grid)" rx="16" />

        {/* Map Geometry Features */}
        {features.map((feature) => {
          if (feature.geometry_type === "POLYGON") {
            return (
              <polygon
                key={feature.feature_id}
                points={points(feature)}
                className={className(feature)}
              />
            );
          }
          if (feature.geometry_type === "POLYLINE") {
            return (
              <polyline
                key={feature.feature_id}
                points={points(feature)}
                className={className(feature)}
              />
            );
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

        {/* Peer Fleet Drivers (V2V) */}
        {activePeers.map((peer) => {
          const px = PADDING + peer.x_m * SCALE;
          const py = HEIGHT - PADDING - peer.y_m * SCALE;
          return (
            <g
              key={peer.vehicle_id}
              className="map-peer-vehicle"
              transform={`translate(${px} ${py}) rotate(${peer.heading_deg})`}
              filter="url(#peer-glow)"
            >
              <path d="M 0 -8 L 5 6 L 0 4 L -5 6 Z" fill="#f59e0b" stroke="#030712" strokeWidth="1.5" />
              <circle cx="0" cy="0" r="9" fill="rgba(245, 158, 11, 0.15)" stroke="#f59e0b" strokeWidth="1" />
              <text
                x="0"
                y="-11"
                textAnchor="middle"
                fontSize="7"
                fill="#f59e0b"
                fontWeight="700"
                transform={`rotate(${-peer.heading_deg})`}
              >
                {peer.vehicle_id}
              </text>
            </g>
          );
        })}

        {/* Primary Driver Vehicle */}
        {world.vehicles.map((vehicle, idx) => {
          const vx = PADDING + vehicle.x_m * SCALE;
          const vy = HEIGHT - PADDING - vehicle.y_m * SCALE;
          const isPrimary = idx === 0;
          return (
            <g
              key={vehicle.vehicle_id}
              className="map-vehicle"
              transform={`translate(${vx} ${vy}) rotate(${vehicle.heading_deg})`}
              filter="url(#vehicle-glow)"
            >
              <path d="M 0 -10 L 7 8 L 0 6 L -7 8 Z" fill="#38bdf8" stroke="#030712" strokeWidth="2" />
              <circle cx="0" cy="0" r="12" fill="rgba(56, 189, 248, 0.18)" stroke="#38bdf8" strokeWidth="1.2" />
              {isPrimary && (
                <text
                  x="0"
                  y="-13"
                  textAnchor="middle"
                  fontSize="7.5"
                  fill="#38bdf8"
                  fontWeight="bold"
                  transform={`rotate(${-vehicle.heading_deg})`}
                >
                  YOU
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="map-legend" aria-label="Map legend">
        <span><i className="legend-road" />Road</span>
        <span><i className="legend-route" />Route</span>
        <span><i className="legend-hazard" />Hazard</span>
        <span><i className="legend-vehicle" />Primary (You)</span>
        {activePeers.length > 0 && <span><i className="legend-peer" />Peer Fleet</span>}
      </div>
    </div>
  );
}
