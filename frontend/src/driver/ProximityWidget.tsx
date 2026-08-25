import type { SpatialPoint, VehiclePose } from "../types";
import { spatialPointToPlot } from "./driverAwareness";

export { spatialPointToPlot } from "./driverAwareness";

function displayName(sensorId: string): string {
  return sensorId
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

interface TofRangePlotProps {
  points: SpatialPoint[];
  vehicle: VehiclePose;
  className?: string;
  label?: string;
}

export function TofRangePlot({
  points,
  vehicle,
  className = "proximity-svg",
  label,
}: TofRangePlotProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      role="img"
      aria-label={label ?? `Vehicle-centred ToF view with ${points.length} mapped returns`}
    >
      <circle className="proximity-band" cx="120" cy="120" r="91" />
      <circle className="proximity-band" cx="120" cy="120" r="62" />
      <circle className="proximity-band" cx="120" cy="120" r="35" />
      <path className="proximity-axis" d="M120 20V220M20 120H220" />
      {points.map((point, index) => {
        const endpoint = spatialPointToPlot(point, vehicle);
        return (
          <circle
            key={`${point.source_sensor_id}-${point.timestamp_ms}-${index}`}
            className={`range-hit ${point.quality < 0.65 ? "range-hit-low" : ""}`}
            cx={endpoint.x}
            cy={endpoint.y}
            r="3.4"
          >
            <title>
              {`${displayName(point.source_sensor_id)} return: ${endpoint.distance_m.toFixed(2)} m from vehicle`}
            </title>
          </circle>
        );
      })}
      <g className="vehicle-glyph">
        <rect x="104" y="93" width="32" height="54" rx="9" />
        <path d="M120 83l8 12h-16z" />
        <circle cx="120" cy="120" r="4" />
      </g>
      <text x="120" y="13" textAnchor="middle">FRONT</text>
    </svg>
  );
}

interface ProximityWidgetProps {
  points: SpatialPoint[];
  vehicle: VehiclePose;
  validReadingCount: number;
}

export function ProximityWidget({
  points,
  vehicle,
  validReadingCount,
}: ProximityWidgetProps) {
  return (
    <article className="proximity-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Range awareness</p>
          <h2>360° proximity</h2>
        </div>
        <span className="source-badge">ToF 2D/2.5D</span>
      </div>
      <TofRangePlot
        points={points}
        vehicle={vehicle}
        label={`Vehicle-centred ToF view with ${points.length} mapped returns`}
      />
      {points.length === 0 && (
        <p className="proximity-empty">
          {validReadingCount > 0
            ? `${validReadingCount} valid readings. No mapped returns.`
            : "No valid ToF readings."}
        </p>
      )}
      <div className="proximity-key">
        <span><i className="key-sensor" />ToF return</span>
        <span><i className="key-low" />lower confidence</span>
      </div>
    </article>
  );
}
