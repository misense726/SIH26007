import type { MapFeature } from "../types";

export function ReferenceMapLegend({ features }: { features: MapFeature[] }) {
  const has = (type: MapFeature["feature_type"]) =>
    features.some((f) => f.feature_type === type);
  return (
    <div className="reference-map-legend" aria-label="Map legend">
      <strong>Map legend</strong>
      <ul>
        <li>
          <svg viewBox="-18 -18 36 36" aria-hidden="true">
            <path d="M0-14L10 10L0 6L-10 10Z" fill="var(--fleet-primary)" />
          </svg>
          Primary vehicle
        </li>
        <li>
          <svg viewBox="-18 -18 36 36" aria-hidden="true">
            <path d="M0-14L10 10L0 6L-10 10Z" fill="var(--fleet-peer)" />
          </svg>
          Peer vehicle
        </li>
        <li>
          <svg viewBox="-18 -18 36 36" aria-hidden="true">
            <circle
              r="12"
              fill="none"
              stroke="var(--fleet-primary)"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </svg>
          Selected vehicle
        </li>
        {has("ROAD") && (
          <li>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <rect x="3" y="10" width="30" height="16" className="map-road" />
            </svg>
            Road
          </li>
        )}
        {has("ROUTE") && (
          <li>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <path d="M3 18H33" className="map-route" />
            </svg>
            Assigned route
          </li>
        )}
        {has("HAZARD_ZONE") && (
          <li>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <rect
                x="3"
                y="7"
                width="30"
                height="22"
                className="map-hazard-zone"
              />
            </svg>
            Hazard zone
          </li>
        )}
        {has("BERM") && (
          <li>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <path d="M3 18H33" className="map-berm" />
            </svg>
            Berm / boundary
          </li>
        )}
      </ul>
    </div>
  );
}
