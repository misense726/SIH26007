import type { RangeReading } from "../types";

const SENSOR_BASE_ANGLE: Record<string, number> = {
  front_scanner: 0,
  rear_scanner: 180,
  front_left: -25,
  front_right: 25,
  left_side: -90,
  right_side: 90,
};

export function proximityPoint(reading: RangeReading): { x: number; y: number } {
  const angle = (SENSOR_BASE_ANGLE[reading.sensor_id] ?? 0) + reading.angle_deg;
  const radians = (angle * Math.PI) / 180;
  const distance = Math.min(4, reading.range_m) * 22;
  return {
    x: 120 + Math.sin(radians) * distance,
    y: 120 - Math.cos(radians) * distance,
  };
}

export function ProximityWidget({ readings }: { readings: RangeReading[] }) {
  return (
    <article className="proximity-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Range awareness</p>
          <h2>360° proximity</h2>
        </div>
        <span className="source-badge">ToF 2D/2.5D</span>
      </div>
      <svg className="proximity-svg" viewBox="0 0 240 240" role="img" aria-label="Vehicle-centred ToF proximity view">
        <circle className="proximity-band proximity-band-safe" cx="120" cy="120" r="91" />
        <circle className="proximity-band proximity-band-caution" cx="120" cy="120" r="62" />
        <circle className="proximity-band proximity-band-danger" cx="120" cy="120" r="35" />
        <path className="proximity-axis" d="M120 20V220M20 120H220" />
        {readings.map((reading) => {
          const endpoint = proximityPoint(reading);
          return (
            <g key={`${reading.sensor_id}-${reading.angle_deg}`}>
              <line className="range-ray" x1="120" y1="120" x2={endpoint.x} y2={endpoint.y} />
              <circle
                className={`range-hit ${reading.quality < 0.55 ? "range-hit-low" : ""}`}
                cx={endpoint.x}
                cy={endpoint.y}
                r="3.4"
              >
                <title>{`${reading.sensor_id}: ${reading.range_m.toFixed(2)} m`}</title>
              </circle>
            </g>
          );
        })}
        <g className="vehicle-glyph">
          <rect x="104" y="93" width="32" height="54" rx="9" />
          <path d="M120 83l8 12h-16z" />
          <circle cx="120" cy="120" r="4" />
        </g>
        <text x="120" y="13" textAnchor="middle">FRONT</text>
      </svg>
      <div className="proximity-key">
        <span><i className="key-safe" />clearance</span>
        <span><i className="key-caution" />caution</span>
        <span><i className="key-danger" />critical</span>
      </div>
    </article>
  );
}

