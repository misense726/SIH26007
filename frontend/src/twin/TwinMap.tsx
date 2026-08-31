import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { MapFeature, Point2D, WorldState } from "../types";
import { DEFAULT_CAMPUS_CONFIG, EMPTY_MAP_TILE } from "../maps/campusConfig";
import { cartesianToGeodetic } from "../maps/locationProvider";
import { primaryVehicleOrNull } from "../state/selectors";

const SCALE = 10;
const PADDING = 16;
const HEIGHT = 420;
const WIDTH = 340;

function point(pointValue: Point2D): string {
  return `${PADDING + pointValue.x_m * SCALE},${HEIGHT - PADDING - pointValue.y_m * SCALE}`;
}

function points(feature: MapFeature): string {
  return feature.points.map(point).join(" ");
}

function className(feature: MapFeature): string {
  return `map-feature map-${feature.feature_type.toLowerCase().replace("_", "-")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

interface TwinMapProps {
  world: WorldState;
  selectedTruckId?: string | null;
  onSelectTruck?: (truckId: string | null) => void;
}

export function TwinMap({ world, selectedTruckId, onSelectTruck }: TwinMapProps) {
  const [viewMode, setViewMode] = useState<"schematic" | "road">("schematic");
  const leafletContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const features = world.reference_map?.features ?? [];
  const primaryVehicle = primaryVehicleOrNull(world);
  const activePeers = world.v2x?.active_peers ?? [];

  // All trucks in fleet
  const allTrucks = [
    ...(primaryVehicle ? [{
      vehicle_id: primaryVehicle.vehicle_id,
      is_primary: true,
      x_m: primaryVehicle.x_m,
      y_m: primaryVehicle.y_m,
      heading_deg: primaryVehicle.heading_deg,
      speed_mps: primaryVehicle.speed_mps,
      emergency_state: world.emergency.state,
      color: "#38bdf8",
      label: `${primaryVehicle.vehicle_id} [PRIMARY]`,
    }] : []),
    ...activePeers.map((peer, idx) => ({
      vehicle_id: peer.vehicle_id,
      is_primary: false,
      x_m: peer.x_m,
      y_m: peer.y_m,
      heading_deg: peer.heading_deg,
      speed_mps: peer.speed_mps,
      emergency_state: peer.emergency_state,
      distance_m: peer.distance_m,
      color: idx % 2 === 0 ? "#f59e0b" : "#10b981",
      label: peer.vehicle_id,
    })),
  ];

  // Initialize the road map only while that view is visible.
  useEffect(() => {
    if (viewMode !== "road" || !leafletContainerRef.current || leafletMapRef.current) return;

    const initialVehicle = primaryVehicle ?? allTrucks[0];
    const primaryGeo = initialVehicle
      ? cartesianToGeodetic(
          initialVehicle.x_m,
          initialVehicle.y_m,
          DEFAULT_CAMPUS_CONFIG.anchor,
        )
      : DEFAULT_CAMPUS_CONFIG.siteCenter;

    const map = L.map(leafletContainerRef.current, {
      center: [primaryGeo.lat, primaryGeo.lng],
      zoom: DEFAULT_CAMPUS_CONFIG.extendedZoom,
      minZoom: DEFAULT_CAMPUS_CONFIG.minZoom,
      maxZoom: DEFAULT_CAMPUS_CONFIG.maxZoom,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });

    L.tileLayer(DEFAULT_CAMPUS_CONFIG.tiles.url, {
      attribution: DEFAULT_CAMPUS_CONFIG.tiles.attribution,
      maxNativeZoom: DEFAULT_CAMPUS_CONFIG.tiles.maxZoom,
      maxZoom: DEFAULT_CAMPUS_CONFIG.maxZoom,
      errorTileUrl: EMPTY_MAP_TILE,
      updateWhenIdle: true,
      keepBuffer: 4,
    }).addTo(map);

    leafletMapRef.current = map;

    return () => {
      map.remove();
      leafletMapRef.current = null;
      markersRef.current.clear();
    };
  }, [viewMode]);

  // Update positions without recreating marker nodes, which avoids label flicker.
  useEffect(() => {
    if (viewMode !== "road" || !leafletMapRef.current) return;
    const map = leafletMapRef.current;
    const currentIds = new Set<string>();

    allTrucks.forEach((truck) => {
      currentIds.add(truck.vehicle_id);
      const geo = cartesianToGeodetic(truck.x_m, truck.y_m, DEFAULT_CAMPUS_CONFIG.anchor);
      const latLng: [number, number] = [geo.lat, geo.lng];
      const isSelected = selectedTruckId === truck.vehicle_id;
      const safeHeading = Number.isFinite(truck.heading_deg) ? truck.heading_deg : 0;
      const safeSpeedKmh = Number.isFinite(truck.speed_mps)
        ? (truck.speed_mps * 3.6).toFixed(0)
        : "--";

      let marker = markersRef.current.get(truck.vehicle_id);
      if (!marker) {
        const icon = L.divIcon({
          className: "campus-vehicle-icon-wrap",
          html:
            '<div class="campus-navigation-pointer ' +
            (truck.is_primary ? "primary-driver" : "peer-driver") +
            (isSelected ? " marker-selected" : "") +
            '" style="transform: rotate(' +
            safeHeading +
            'deg);"><svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">' +
            '<path d="M16 3 L27 28 L16 23 L5 28 Z" fill="' +
            truck.color +
            '" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" /></svg></div>' +
            '<div class="campus-driver-label ' +
            (truck.is_primary ? "primary-label" : "peer-label") +
            '"><strong>' +
            escapeHtml(truck.label) +
            '</strong><span class="campus-marker-speed">' +
            safeSpeedKmh +
            " km/h</span></div>",
          iconSize: [92, 54],
          iconAnchor: [46, 16],
        });
        marker = L.marker(latLng, {
          icon,
          title: truck.label,
          zIndexOffset: truck.is_primary ? 1000 : 800,
        }).addTo(map);
        marker.on("click", () => onSelectTruck?.(truck.vehicle_id));
        markersRef.current.set(truck.vehicle_id, marker);
      } else {
        marker.setLatLng(latLng);
        const element = marker.getElement();
        const pointer = element?.querySelector<HTMLElement>(".campus-navigation-pointer");
        if (pointer) {
          pointer.style.transform = `rotate(${safeHeading}deg)`;
          pointer.classList.toggle("marker-selected", isSelected);
        }
        element?.querySelector<SVGPathElement>(".campus-navigation-pointer path")
          ?.setAttribute("fill", truck.color);
        const speed = element?.querySelector<HTMLElement>(".campus-marker-speed");
        if (speed) speed.textContent = `${safeSpeedKmh} km/h`;
      }
    });

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
      }
    });
  }, [viewMode, allTrucks, selectedTruckId, onSelectTruck]);

  return (
    <div className="supervisor-fleet-map-container" aria-label="Fleet map">
      {/* Top Map Control Bar */}
      <div className="fleet-map-top-bar">
        {/* Quick Truck Selector Pills */}
        <div className="fleet-truck-quick-selector" role="group" aria-label="Truck focus selector">
          <button
            type="button"
            className={`truck-pill-btn ${selectedTruckId === null || selectedTruckId === undefined ? "active" : ""}`}
            onClick={() => onSelectTruck?.(null)}
            aria-pressed={selectedTruckId === null || selectedTruckId === undefined}
          >
            All vehicles ({allTrucks.length})
          </button>
          {allTrucks.map((truck) => {
            const isSelected = selectedTruckId === truck.vehicle_id;
            return (
              <button
                key={truck.vehicle_id}
                type="button"
                className={`truck-pill-btn ${isSelected ? "active" : ""}`}
                style={{ borderColor: isSelected ? truck.color : undefined }}
                onClick={() => onSelectTruck?.(truck.vehicle_id)}
                aria-pressed={isSelected}
                title={`Track ${truck.label}`}
              >
                <span className="truck-dot" style={{ backgroundColor: truck.color }} />
                <strong>{truck.vehicle_id}</strong>
                <small>{(truck.speed_mps * 3.6).toFixed(0)} km/h</small>
              </button>
            );
          })}
        </div>

        {/* View mode switcher */}
        <div className="fleet-view-mode-toggle" role="group" aria-label="Map display mode">
          <button
            type="button"
            className={`fleet-mode-btn ${viewMode === "schematic" ? "active" : ""}`}
            onClick={() => setViewMode("schematic")}
            aria-pressed={viewMode === "schematic"}
            title="Show schematic map"
          >
            Twin schematic
          </button>
          <button
            type="button"
            className={`fleet-mode-btn ${viewMode === "road" ? "active" : ""}`}
            onClick={() => setViewMode("road")}
            aria-pressed={viewMode === "road"}
            title="Show road map"
          >
            Road map
          </button>
        </div>
      </div>

      {/* Main Map Viewport */}
      {viewMode === "schematic" ? (
        <div className="twin-map-schematic-wrap">
          <svg
            className="twin-map"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label="Fixed top-down digital twin schematic with all fleet trucks"
          >
            <defs>
              <pattern id="twin-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path className="map-grid-line" d="M 20 0 L 0 0 0 20" fill="none" />
              </pattern>
              <filter id="lead-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="peer-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Digital twin grid */}
            <rect width={WIDTH} height={HEIGHT} fill="url(#twin-grid)" rx="16" />

            {/* Map Reference Features (Road, Berms, Hazard Zones) */}
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

            {/* All Fleet Trucks Rendered Prominently */}
            {allTrucks.map((truck) => {
              const tx = PADDING + truck.x_m * SCALE;
              const ty = HEIGHT - PADDING - truck.y_m * SCALE;
              const isSelected = selectedTruckId === truck.vehicle_id;
              const isAlert = truck.emergency_state && truck.emergency_state !== "SAFE";

              return (
                <g
                  key={truck.vehicle_id}
                  className={`map-truck-group ${isSelected ? "truck-selected" : ""} ${truck.is_primary ? "lead-truck" : "peer-truck"}`}
                  transform={`translate(${tx} ${ty})`}
                  onClick={() => onSelectTruck?.(truck.vehicle_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectTruck?.(truck.vehicle_id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Show ${truck.vehicle_id} on the fleet map`}
                  style={{ cursor: "pointer" }}
                >
                  {/* Highlight tracking ring if selected */}
                  {isSelected && (
                    <circle
                      cx="0"
                      cy="0"
                      r="18"
                      fill="none"
                      stroke={truck.color}
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      className="truck-selection-ring"
                    />
                  )}

                  {/* Directional Truck Body */}
                  <g
                    transform={`rotate(${truck.heading_deg})`}
                    filter={truck.is_primary ? "url(#lead-glow)" : "url(#peer-glow)"}
                  >
                    {/* Truck chassis */}
                    <rect
                      x="-6"
                      y="-11"
                      width="12"
                      height="20"
                      rx="2"
                      fill="#090e17"
                      stroke={truck.color}
                      strokeWidth="1.6"
                    />
                    {/* Directional pointer arrow */}
                    <path d="M 0 -13 L 5 -5 L -5 -5 Z" fill={truck.color} />
                    {/* Cab windshield */}
                    <rect x="-4.5" y="-9" width="9" height="4" rx="1" fill={truck.color} opacity="0.9" />
                    {/* Cargo bed */}
                    <rect
                      x="-4.5"
                      y="-3"
                      width="9"
                      height="10"
                      rx="1"
                      fill={isAlert ? "#ef4444" : truck.color}
                      opacity="0.35"
                    />
                  </g>

                  {/* Callsign & Speed Label Tag */}
                  <g transform="translate(0, -18)">
                    <rect
                      x="-38"
                      y="-12"
                      width="76"
                      height="15"
                      rx="4"
                      fill="rgba(3, 7, 18, 0.92)"
                      stroke={isSelected ? "#ffffff" : truck.color}
                      strokeWidth={isSelected ? "1.5" : "1"}
                    />
                    <text
                      x="0"
                      y="-2"
                      textAnchor="middle"
                      fontSize="7.5"
                      fill={isSelected ? "#ffffff" : truck.color}
                      fontWeight="800"
                      fontFamily="monospace"
                    >
                      {truck.vehicle_id}
                    </text>
                  </g>

                  {/* Speed Tag Badge below truck */}
                  <g transform="translate(0, 16)">
                    <rect
                      x="-24"
                      y="-9"
                      width="48"
                      height="12"
                      rx="3"
                      fill="rgba(15, 23, 42, 0.88)"
                      stroke="rgba(255, 255, 255, 0.15)"
                      strokeWidth="0.8"
                    />
                    <text
                      x="0"
                      y="-1"
                      textAnchor="middle"
                      fontSize="6.5"
                      fill="#cbd5e1"
                      fontFamily="monospace"
                    >
                      {(truck.speed_mps * 3.6).toFixed(0)} km/h
                    </text>
                  </g>
                </g>
              );
            })}
            {allTrucks.length === 0 && (
              <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="map-empty-label">
                No vehicle telemetry
              </text>
            )}
          </svg>

          {/* Map Legend */}
          <div className="fleet-map-legend" aria-label="Fleet Map Legend">
            <span><i className="legend-lead-truck" />Primary vehicle</span>
            <span><i className="legend-peer-truck" />Simulated peers</span>
            <span><i className="legend-road" />Haul Road</span>
            <span><i className="legend-hazard" />Hazard Zone</span>
          </div>
        </div>
      ) : (
        <div className="twin-map-road-wrap">
          <div ref={leafletContainerRef} className="fleet-leaflet-container" />
          <div className="fleet-road-hud">
            <span>{DEFAULT_CAMPUS_CONFIG.locationLabel}</span>
            <span>{allTrucks.length} vehicles tracked</span>
          </div>
        </div>
      )}
    </div>
  );
}
