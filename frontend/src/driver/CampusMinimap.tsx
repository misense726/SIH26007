import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { VehiclePose, WorldState } from "../types";
import { DEFAULT_CAMPUS_CONFIG } from "../maps/campusConfig";
import { cartesianToGeodetic, formatCoordinates } from "../maps/locationProvider";

interface CampusMinimapProps {
  world: WorldState;
  vehicle: VehiclePose;
  onExpand: () => void;
}

function createVehicleIcon(headingDeg: number) {
  return L.divIcon({
    className: "campus-vehicle-icon-wrap",
    html: `
      <div class="campus-vehicle-marker" style="transform: rotate(${headingDeg}deg);">
        <div class="campus-vehicle-pulse"></div>
        <svg viewBox="0 0 24 24" width="24" height="24" class="campus-vehicle-svg">
          <path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#60a5fa" stroke="#0f172a" stroke-width="1.5" />
          <circle cx="12" cy="11" r="3" fill="#ffffff" />
        </svg>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function createPoiIcon(category: string, label: string) {
  return L.divIcon({
    className: "campus-poi-icon-wrap",
    html: `
      <div class="campus-poi-marker campus-poi-${category.toLowerCase()}">
        <span class="campus-poi-dot"></span>
        <span class="campus-poi-label">${label}</span>
      </div>
    `,
    iconSize: [80, 24],
    iconAnchor: [40, 12],
  });
}

export function CampusMinimap({ world, vehicle, onExpand }: CampusMinimapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  // Convert vehicle cartesian pose (x_m, y_m) to test campus coordinates
  const vehicleCoords = cartesianToGeodetic(
    vehicle.x_m,
    vehicle.y_m,
    DEFAULT_CAMPUS_CONFIG.anchor,
  );

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: [number, number] = [vehicleCoords.lat, vehicleCoords.lng];
    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: DEFAULT_CAMPUS_CONFIG.minimapZoom,
      minZoom: DEFAULT_CAMPUS_CONFIG.minZoom,
      maxZoom: DEFAULT_CAMPUS_CONFIG.maxZoom,
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: false,
    });

    // CARTO Dark Matter Tiles
    L.tileLayer(DEFAULT_CAMPUS_CONFIG.tiles.url, {
      subdomains: DEFAULT_CAMPUS_CONFIG.tiles.subdomains,
      maxZoom: DEFAULT_CAMPUS_CONFIG.tiles.maxZoom,
    }).addTo(map);

    // Initial vehicle marker
    const vehicleMarker = L.marker(initialCenter, {
      icon: createVehicleIcon(vehicle.heading_deg),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(map);
    vehicleMarkerRef.current = vehicleMarker;

    // Plot Reference Twin Route on the Campus Map
    if (world.reference_map?.features) {
      const routeFeature = world.reference_map.features.find(
        (f) => f.feature_type === "ROUTE" || f.feature_type === "CENTERLINE",
      );
      if (routeFeature && routeFeature.points.length > 0) {
        const latLngs: [number, number][] = routeFeature.points.map((pt) => {
          const geo = cartesianToGeodetic(pt.x_m, pt.y_m, DEFAULT_CAMPUS_CONFIG.anchor);
          return [geo.lat, geo.lng];
        });

        const routePolyline = L.polyline(latLngs, {
          color: "#38bdf8",
          weight: 4,
          opacity: 0.85,
          dashArray: "6, 8",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
        routeLayerRef.current = routePolyline;
      }
    }

    // Add POIs
    DEFAULT_CAMPUS_CONFIG.pois.forEach((poi) => {
      L.marker([poi.coordinates.lat, poi.coordinates.lng], {
        icon: createPoiIcon(poi.category, poi.name),
        interactive: false,
      }).addTo(map);
    });

    // Listen to user drag to temporarily disable auto-follow
    map.on("dragstart", () => setAutoFollow(false));

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      vehicleMarkerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

  // Update vehicle position and heading
  useEffect(() => {
    if (!mapInstanceRef.current || !vehicleMarkerRef.current) return;

    const newLatLng: [number, number] = [vehicleCoords.lat, vehicleCoords.lng];
    vehicleMarkerRef.current.setLatLng(newLatLng);
    vehicleMarkerRef.current.setIcon(createVehicleIcon(vehicle.heading_deg));

    if (autoFollow) {
      mapInstanceRef.current.panTo(newLatLng, { animate: true, duration: 0.3 });
    }
  }, [vehicleCoords.lat, vehicleCoords.lng, vehicle.heading_deg, autoFollow]);

  // Invalidate size in case of container layout changes
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.invalidateSize();
    }
  });

  return (
    <article className="campus-minimap-card" aria-label="Campus Navigation Minimap">
      <div className="campus-minimap-header">
        <div className="campus-minimap-title-group">
          <p className="eyebrow">2D Campus GPS</p>
          <h3>Campus Nav</h3>
        </div>
        <div className="campus-minimap-actions">
          {!autoFollow && (
            <button
              type="button"
              className="campus-recenter-btn"
              title="Recenter on vehicle"
              onClick={() => {
                setAutoFollow(true);
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.setView(
                    [vehicleCoords.lat, vehicleCoords.lng],
                    DEFAULT_CAMPUS_CONFIG.minimapZoom,
                    { animate: true },
                  );
                }
              }}
            >
              Recenter
            </button>
          )}
          <button
            type="button"
            className="campus-expand-btn"
            title="Expand into full campus view"
            aria-label="Expand campus map"
            onClick={onExpand}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Expand</span>
          </button>
        </div>
      </div>

      <div className="campus-minimap-stage" onClick={onExpand} title="Click to open extended campus map">
        <div ref={mapContainerRef} className="campus-minimap-leaflet-container" />
        <div className="campus-minimap-overlay-hud" pointer-events="none">
          <div className="campus-hud-coords">
            <span>{formatCoordinates(vehicleCoords, 4)}</span>
          </div>
          <div className="campus-hud-status">
            <span className="campus-status-dot"></span>
            <span>SIM GPS</span>
          </div>
        </div>
      </div>
    </article>
  );
}
