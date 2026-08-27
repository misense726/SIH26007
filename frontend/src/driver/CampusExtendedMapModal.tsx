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

function createPrimaryVehicleIcon(headingDeg: number, vehicleId: string) {
  return L.divIcon({
    className: "campus-vehicle-icon-wrap",
    html: `
      <div class="campus-vehicle-marker campus-vehicle-marker-large primary-driver" style="transform: rotate(${headingDeg}deg);">
        <div class="campus-vehicle-pulse"></div>
        <svg viewBox="0 0 32 32" width="32" height="32" class="campus-vehicle-svg">
          <path d="M16 2 L26 26 L16 20 L6 26 Z" fill="#38bdf8" stroke="#030712" stroke-width="2" />
          <circle cx="16" cy="14" r="4" fill="#ffffff" />
        </svg>
      </div>
      <div class="campus-driver-label primary-label extended-driver-label">
        <strong>${vehicleId} (YOU)</strong>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function createPeerVehicleIcon(headingDeg: number, vehicleId: string, distanceM: number, speedMps: number, emergency: string) {
  const isEmergency = emergency && emergency !== "SAFE";
  return L.divIcon({
    className: "campus-vehicle-icon-wrap peer-driver-wrap",
    html: `
      <div class="campus-vehicle-marker campus-vehicle-marker-large peer-driver ${isEmergency ? "peer-alert" : ""}" style="transform: rotate(${headingDeg}deg);">
        <svg viewBox="0 0 28 28" width="28" height="28" class="campus-vehicle-svg">
          <path d="M14 2 L22 22 L14 17 L6 22 Z" fill="${isEmergency ? "#ef4444" : "#f59e0b"}" stroke="#030712" stroke-width="1.8" />
          <circle cx="14" cy="12" r="3.5" fill="#ffffff" />
        </svg>
      </div>
      <div class="campus-driver-label peer-label extended-driver-label">
        <strong>${vehicleId}</strong>
        <span>${(speedMps * 3.6).toFixed(0)} km/h | ${Math.round(distanceM)}m</span>
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
  const peerMarkersRef = useRef<Map<string, L.Marker>>(new Map());
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

  const activePeers = world.v2x?.active_peers ?? [];
  const corridorState = telemetryConnected ? world.safe_corridor.state : "GREY";

  // ESC key to close modal
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
      preferCanvas: true,
    });

    // Custom Zoom & Scale control
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);

    // Fast-loading CARTO Dark Matter Tiles
    L.tileLayer(DEFAULT_CAMPUS_CONFIG.tiles.url, {
      subdomains: DEFAULT_CAMPUS_CONFIG.tiles.subdomains,
      attribution: DEFAULT_CAMPUS_CONFIG.tiles.attribution,
      maxZoom: DEFAULT_CAMPUS_CONFIG.tiles.maxZoom,
      updateWhenIdle: false,
      updateWhenZooming: true,
      keepBuffer: 8,
    }).addTo(map);

    // Primary Vehicle Marker
    const vehicleMarker = L.marker(initialCenter, {
      icon: createPrimaryVehicleIcon(vehicle.heading_deg, vehicle.vehicle_id || "PRIMARY DUMPER"),
      zIndexOffset: 1000,
    }).addTo(map);
    vehicleMarkerRef.current = vehicleMarker;

    // Reference Route
    if (world.reference_map?.features) {
      const routeFeature = world.reference_map.features.find(
        (f) => f.feature_type === "ROUTE" || f.feature_type === "CENTERLINE",
      );
      if (routeFeature && routeFeature.points.length > 0) {
        const latLngs: [number, number][] = routeFeature.points.map((pt) => {
          const geo = cartesianToGeodetic(pt.x_m, pt.y_m, DEFAULT_CAMPUS_CONFIG.anchor);
          return [geo.lat, geo.lng];
        });

        // Glow backing
        L.polyline(latLngs, {
          color: "#0284c7",
          weight: 10,
          opacity: 0.3,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);

        const routePolyline = L.polyline(latLngs, {
          color: "#38bdf8",
          weight: 4.5,
          opacity: 0.95,
          dashArray: "10, 12",
          className: "animated-campus-route",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
        routeLayerRef.current = routePolyline;
      }
    }

    // POIs Layer
    const poiGroup = L.layerGroup();
    DEFAULT_CAMPUS_CONFIG.pois.forEach((poi) => {
      const poiMarker = L.marker([poi.coordinates.lat, poi.coordinates.lng], {
        icon: createPoiIcon(poi.category, poi.name),
      });
      poiMarker.bindPopup(`
        <div class="campus-popup-content">
          <h4>${poi.name}</h4>
          <p class="campus-popup-category">${poi.category}</p>
          <p>${poi.description ?? "Campus location"}</p>
        </div>
      `);
      poiGroup.addLayer(poiMarker);
    });
    poiGroup.addTo(map);
    poiLayerGroupRef.current = poiGroup;

    map.on("dragstart", () => setAutoFollow(false));
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      vehicleMarkerRef.current = null;
      peerMarkersRef.current.clear();
      routeLayerRef.current = null;
      poiLayerGroupRef.current = null;
    };
  }, []);

  // Update primary vehicle position
  useEffect(() => {
    if (!mapInstanceRef.current || !vehicleMarkerRef.current) return;

    const newLatLng: [number, number] = [vehicleCoords.lat, vehicleCoords.lng];
    vehicleMarkerRef.current.setLatLng(newLatLng);
    vehicleMarkerRef.current.setIcon(
      createPrimaryVehicleIcon(vehicle.heading_deg, vehicle.vehicle_id || "PRIMARY DUMPER"),
    );

    if (autoFollow) {
      mapInstanceRef.current.panTo(newLatLng, { animate: true, duration: 0.25 });
    }
  }, [vehicleCoords.lat, vehicleCoords.lng, vehicle.heading_deg, autoFollow, vehicle.vehicle_id]);

  // Update peer driver markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const currentPeerIds = new Set<string>();

    activePeers.forEach((peer) => {
      currentPeerIds.add(peer.vehicle_id);
      const peerGeo = cartesianToGeodetic(peer.x_m, peer.y_m, DEFAULT_CAMPUS_CONFIG.anchor);
      const peerLatLng: [number, number] = [peerGeo.lat, peerGeo.lng];

      let marker = peerMarkersRef.current.get(peer.vehicle_id);
      if (!marker) {
        marker = L.marker(peerLatLng, {
          icon: createPeerVehicleIcon(
            peer.heading_deg,
            peer.vehicle_id,
            peer.distance_m,
            peer.speed_mps,
            peer.emergency_state,
          ),
          zIndexOffset: 800,
        }).addTo(map);
        marker.bindPopup(`
          <div class="campus-popup-content">
            <h4>${peer.vehicle_id}</h4>
            <p>Speed: <strong>${(peer.speed_mps * 3.6).toFixed(1)} km/h</strong></p>
            <p>Distance: <strong>${peer.distance_m} m</strong></p>
            <p>Status: <strong>${peer.emergency_state}</strong> (${peer.link_status})</p>
          </div>
        `);
        peerMarkersRef.current.set(peer.vehicle_id, marker);
      } else {
        marker.setLatLng(peerLatLng);
        marker.setIcon(
          createPeerVehicleIcon(
            peer.heading_deg,
            peer.vehicle_id,
            peer.distance_m,
            peer.speed_mps,
            peer.emergency_state,
          ),
        );
      }
    });

    peerMarkersRef.current.forEach((marker, id) => {
      if (!currentPeerIds.has(id)) {
        map.removeLayer(marker);
        peerMarkersRef.current.delete(id);
      }
    });
  }, [activePeers]);

  // Toggle POIs visibility
  useEffect(() => {
    if (!mapInstanceRef.current || !poiLayerGroupRef.current) return;
    if (showPois) {
      poiLayerGroupRef.current.addTo(mapInstanceRef.current);
    } else {
      mapInstanceRef.current.removeLayer(poiLayerGroupRef.current);
    }
  }, [showPois]);

  // Toggle Route visibility
  useEffect(() => {
    if (!mapInstanceRef.current || !routeLayerRef.current) return;
    if (showRoute) {
      routeLayerRef.current.addTo(mapInstanceRef.current);
    } else {
      mapInstanceRef.current.removeLayer(routeLayerRef.current);
    }
  }, [showRoute]);

  const handleFocusDriver = (lat: number, lng: number) => {
    if (mapInstanceRef.current) {
      setAutoFollow(false);
      mapInstanceRef.current.setView([lat, lng], 19, { animate: true });
    }
  };

  return (
    <div className="campus-modal-backdrop" onClick={onClose}>
      <div
        className="campus-extended-modal-container"
        role="dialog"
        aria-modal="true"
        aria-label="Extended Campus GPS Map View"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="campus-modal-header">
          <div className="campus-modal-title-wrap">
            <span className="source-badge">GPS + V2X FLEET</span>
            <h2>{DEFAULT_CAMPUS_CONFIG.campusName}</h2>
            <span className="campus-header-coords">
              {formatCoordinates(vehicleCoords, 5)}
            </span>
          </div>

          {/* Action Toolbar */}
          <div className="campus-modal-toolbar">
            <button
              type="button"
              className={`campus-tool-btn ${autoFollow ? "active" : ""}`}
              onClick={() => {
                setAutoFollow(true);
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.setView(
                    [vehicleCoords.lat, vehicleCoords.lng],
                    DEFAULT_CAMPUS_CONFIG.extendedZoom,
                    { animate: true },
                  );
                }
              }}
            >
              {autoFollow ? "Auto-Follow (ON)" : "Recenter (OFF)"}
            </button>
            <button
              type="button"
              className={`campus-tool-btn ${showRoute ? "active" : ""}`}
              onClick={() => setShowRoute(!showRoute)}
            >
              Route {showRoute ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className={`campus-tool-btn ${showPois ? "active" : ""}`}
              onClick={() => setShowPois(!showPois)}
            >
              POIs {showPois ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className="campus-modal-close-btn"
              onClick={onClose}
              title="Close Map (ESC)"
              aria-label="Close extended map"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Map Viewport & Peer Fleet Sidebar */}
        <div className="campus-extended-body">
          <div className="campus-modal-map-stage">
            <div ref={mapContainerRef} className="campus-extended-leaflet-container" />

            {/* Quick telemetry HUD overlay */}
            <div className="campus-modal-hud-overlay">
              <div className="campus-hud-item">
                <span>Speed</span>
                <strong>{telemetryConnected ? `${formatNumber(vehicle.speed_mps * 3.6, 1)} km/h` : "--"}</strong>
              </div>
              <div className="campus-hud-item">
                <span>Heading</span>
                <strong>{telemetryConnected ? `${formatNumber(vehicle.heading_deg, 0)}°` : "--"}</strong>
              </div>
              <div className="campus-hud-item">
                <span>Safe Corridor</span>
                <strong className={`corridor-${corridorState.toLowerCase()}`}>{corridorState}</strong>
              </div>
              <div className="campus-hud-item">
                <span>Active Peers</span>
                <strong>{activePeers.length} Drivers</strong>
              </div>
            </div>
          </div>

          {/* Active Drivers List Sidebar */}
          <aside className="campus-peers-sidebar">
            <div className="campus-peers-header">
              <h3>Fleet Drivers ({activePeers.length + 1})</h3>
              <span className="v2x-stat-pill">V2V Mesh</span>
            </div>

            <div className="campus-driver-cards-list">
              {/* Primary Driver */}
              <div
                className="campus-driver-row primary-row"
                onClick={() => handleFocusDriver(vehicleCoords.lat, vehicleCoords.lng)}
                title="Click to center on your vehicle"
              >
                <div className="campus-driver-row-top">
                  <strong>{vehicle.vehicle_id || "PRIMARY DUMPER"} (YOU)</strong>
                  <span className="driver-role-badge primary">LEAD</span>
                </div>
                <div className="campus-driver-row-stats">
                  <span>Speed: <strong>{(vehicle.speed_mps * 3.6).toFixed(1)} km/h</strong></span>
                  <span>Heading: <strong>{Math.round(vehicle.heading_deg)}°</strong></span>
                </div>
              </div>

              {/* Peer Drivers */}
              {activePeers.map((peer) => {
                const peerGeo = cartesianToGeodetic(peer.x_m, peer.y_m, DEFAULT_CAMPUS_CONFIG.anchor);
                return (
                  <div
                    key={peer.vehicle_id}
                    className="campus-driver-row"
                    onClick={() => handleFocusDriver(peerGeo.lat, peerGeo.lng)}
                    title={`Click to focus map on ${peer.vehicle_id}`}
                  >
                    <div className="campus-driver-row-top">
                      <strong>{peer.vehicle_id}</strong>
                      <span className={`link-badge link-${peer.link_status.toLowerCase()}`}>
                        {peer.link_status}
                      </span>
                    </div>
                    <div className="campus-driver-row-stats">
                      <span>Distance: <strong>{peer.distance_m} m</strong></span>
                      <span>Speed: <strong>{(peer.speed_mps * 3.6).toFixed(1)} km/h</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
