import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { VehiclePose, WorldState } from "../types";
import { DEFAULT_CAMPUS_CONFIG } from "../maps/campusConfig";
import { cartesianToGeodetic, formatCoordinates } from "../maps/locationProvider";
import { formatNumber } from "../state/selectors";

interface CampusExtendedMapModalProps {
  world: WorldState;
  vehicle: VehiclePose;
  telemetryConnected: boolean;
  onClose: () => void;
}

function createVehicleIcon(headingDeg: number) {
  return L.divIcon({
    className: "campus-vehicle-icon-wrap",
    html: `
      <div class="campus-vehicle-marker campus-vehicle-marker-large" style="transform: rotate(${headingDeg}deg);">
        <div class="campus-vehicle-pulse"></div>
        <svg viewBox="0 0 28 28" width="28" height="28" class="campus-vehicle-svg">
          <path d="M14 2 L24 24 L14 19 L4 24 Z" fill="#60a5fa" stroke="#0f172a" stroke-width="2" />
          <circle cx="14" cy="13" r="3.5" fill="#ffffff" />
        </svg>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function createPoiIcon(category: string, label: string) {
  return L.divIcon({
    className: "campus-poi-icon-wrap",
    html: `
      <div class="campus-poi-marker campus-poi-marker-extended campus-poi-${category.toLowerCase()}">
        <span class="campus-poi-dot"></span>
        <span class="campus-poi-label">${label}</span>
      </div>
    `,
    iconSize: [110, 28],
    iconAnchor: [55, 14],
  });
}

export function CampusExtendedMapModal({
  world,
  vehicle,
  telemetryConnected,
  onClose,
}: CampusExtendedMapModalProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const poiLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const [showPois, setShowPois] = useState(true);
  const [showRoute, setShowRoute] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);

  const vehicleCoords = cartesianToGeodetic(
    vehicle.x_m,
    vehicle.y_m,
    DEFAULT_CAMPUS_CONFIG.anchor,
  );

  const corridorState = telemetryConnected ? world.safe_corridor.state : "GREY";

  // ESC key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: [number, number] = [vehicleCoords.lat, vehicleCoords.lng];
    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: DEFAULT_CAMPUS_CONFIG.extendedZoom,
      minZoom: DEFAULT_CAMPUS_CONFIG.minZoom,
      maxZoom: DEFAULT_CAMPUS_CONFIG.maxZoom,
      zoomControl: false,
      attributionControl: true,
    });

    // Custom Zoom control top-left
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);

    // CARTO Dark Matter Tiles
    L.tileLayer(DEFAULT_CAMPUS_CONFIG.tiles.url, {
      subdomains: DEFAULT_CAMPUS_CONFIG.tiles.subdomains,
      attribution: DEFAULT_CAMPUS_CONFIG.tiles.attribution,
      maxZoom: DEFAULT_CAMPUS_CONFIG.tiles.maxZoom,
    }).addTo(map);

    // Route polyline
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
          weight: 5,
          opacity: 0.9,
          dashArray: "8, 10",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
        routeLayerRef.current = routePolyline;
      }
    }

    // POI Layer Group
    const poiGroup = L.layerGroup();
    DEFAULT_CAMPUS_CONFIG.pois.forEach((poi) => {
      const marker = L.marker([poi.coordinates.lat, poi.coordinates.lng], {
        icon: createPoiIcon(poi.category, poi.name),
      });
      if (poi.description) {
        marker.bindPopup(
          `<div class="campus-popup"><strong>${poi.name}</strong><p>${poi.description}</p></div>`,
        );
      }
      poiGroup.addLayer(marker);
    });
    poiGroup.addTo(map);
    poiLayerGroupRef.current = poiGroup;

    // Vehicle Marker
    const vehicleMarker = L.marker(initialCenter, {
      icon: createVehicleIcon(vehicle.heading_deg),
      zIndexOffset: 1000,
    }).addTo(map);
    vehicleMarkerRef.current = vehicleMarker;

    map.on("dragstart", () => setAutoFollow(false));

    mapInstanceRef.current = map;

    // Trigger map invalidation after layout settles
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
      vehicleMarkerRef.current = null;
      routeLayerRef.current = null;
      poiLayerGroupRef.current = null;
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

  // Toggle POIs
  useEffect(() => {
    if (!mapInstanceRef.current || !poiLayerGroupRef.current) return;
    if (showPois) {
      mapInstanceRef.current.addLayer(poiLayerGroupRef.current);
    } else {
      mapInstanceRef.current.removeLayer(poiLayerGroupRef.current);
    }
  }, [showPois]);

  // Toggle Route
  useEffect(() => {
    if (!mapInstanceRef.current || !routeLayerRef.current) return;
    if (showRoute) {
      mapInstanceRef.current.addLayer(routeLayerRef.current);
    } else {
      mapInstanceRef.current.removeLayer(routeLayerRef.current);
    }
  }, [showRoute]);

  function handleRecenter() {
    setAutoFollow(true);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView(
        [vehicleCoords.lat, vehicleCoords.lng],
        DEFAULT_CAMPUS_CONFIG.extendedZoom,
        { animate: true },
      );
    }
  }

  function handleFitCampus() {
    setAutoFollow(false);
    if (mapInstanceRef.current) {
      const allPoints: [number, number][] = DEFAULT_CAMPUS_CONFIG.pois.map((p) => [
        p.coordinates.lat,
        p.coordinates.lng,
      ]);
      allPoints.push([vehicleCoords.lat, vehicleCoords.lng]);
      const bounds = L.latLngBounds(allPoints);
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  return (
    <div className="campus-modal-backdrop" role="dialog" aria-modal="true" aria-label="Extended Campus Navigation Map">
      <div className="campus-extended-modal">
        <header className="campus-extended-header">
          <div className="campus-extended-title">
            <div className="brand-lockup-mini">
              <span className="brand-mark-mini">FS</span>
              <div>
                <p className="eyebrow">Extended Campus Navigation</p>
                <h2>{DEFAULT_CAMPUS_CONFIG.campusName}</h2>
              </div>
            </div>
            <span className="source-badge">SIMULATED GPS · CARTO DARK</span>
          </div>

          <div className="campus-extended-telemetry">
            <div className="campus-telemetry-item">
              <span>Speed</span>
              <strong>{telemetryConnected ? formatNumber(vehicle.speed_mps * 3.6, 1) : "--"} km/h</strong>
            </div>
            <div className="campus-telemetry-item">
              <span>Heading</span>
              <strong>{telemetryConnected ? `${formatNumber(vehicle.heading_deg, 0)}°` : "--"}</strong>
            </div>
            <div className="campus-telemetry-item">
              <span>Coordinates</span>
              <strong>{formatCoordinates(vehicleCoords, 4)}</strong>
            </div>
            <div className="campus-telemetry-item">
              <span>Safe Corridor</span>
              <strong className={`corridor-${corridorState.toLowerCase()}`}>{corridorState}</strong>
            </div>
          </div>

          <div className="campus-extended-controls">
            <button
              type="button"
              className={`campus-tool-btn ${autoFollow ? "active" : ""}`}
              onClick={handleRecenter}
              title="Lock camera to vehicle"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="8" />
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
              </svg>
              <span>Recenter</span>
            </button>

            <button
              type="button"
              className="campus-tool-btn"
              onClick={handleFitCampus}
              title="Show entire campus view"
            >
              <span>Fit Campus</span>
            </button>

            <button
              type="button"
              className={`campus-tool-btn ${showPois ? "active" : ""}`}
              onClick={() => setShowPois((v) => !v)}
            >
              <span>POIs</span>
            </button>

            <button
              type="button"
              className={`campus-tool-btn ${showRoute ? "active" : ""}`}
              onClick={() => setShowRoute((v) => !v)}
            >
              <span>Route</span>
            </button>

            <button
              type="button"
              className="campus-close-btn"
              onClick={onClose}
              title="Close extended view (Esc)"
              aria-label="Close extended map"
            >
              <span>Close ✕</span>
            </button>
          </div>
        </header>

        <div className="campus-extended-stage">
          <div ref={mapContainerRef} className="campus-extended-leaflet-container" />
          <div className="campus-extended-legend">
            <div className="legend-item">
              <span className="legend-vehicle-icon">▲</span>
              <span>FogSen Vehicle</span>
            </div>
            <div className="legend-item">
              <span className="legend-route-line"></span>
              <span>Active Haul Route</span>
            </div>
            <div className="legend-item">
              <span className="legend-poi-dot"></span>
              <span>Campus Landmark</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
