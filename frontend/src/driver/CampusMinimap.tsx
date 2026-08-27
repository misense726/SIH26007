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

function createPrimaryVehicleIcon(headingDeg: number, vehicleId: string) {
  return L.divIcon({
    className: "campus-vehicle-icon-wrap",
    html: `
      <div class="campus-vehicle-marker primary-driver" style="transform: rotate(${headingDeg}deg);">
        <div class="campus-vehicle-pulse"></div>
        <svg viewBox="0 0 28 28" width="28" height="28" class="campus-vehicle-svg">
          <path d="M14 2 L22 22 L14 17 L6 22 Z" fill="#38bdf8" stroke="#030712" stroke-width="1.8" />
          <circle cx="14" cy="12" r="3.5" fill="#ffffff" />
        </svg>
      </div>
      <span class="campus-driver-label primary-label">${vehicleId}</span>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function createPeerVehicleIcon(headingDeg: number, vehicleId: string, distanceM: number, emergency: string) {
  const isEmergency = emergency && emergency !== "SAFE";
  return L.divIcon({
    className: "campus-vehicle-icon-wrap peer-driver-wrap",
    html: `
      <div class="campus-vehicle-marker peer-driver ${isEmergency ? "peer-alert" : ""}" style="transform: rotate(${headingDeg}deg);">
        <svg viewBox="0 0 24 24" width="24" height="24" class="campus-vehicle-svg">
          <path d="M12 2 L19 19 L12 15 L5 19 Z" fill="${isEmergency ? "#ef4444" : "#f59e0b"}" stroke="#030712" stroke-width="1.6" />
          <circle cx="12" cy="10" r="3" fill="#ffffff" />
        </svg>
      </div>
      <div class="campus-driver-label peer-label">
        <strong>${vehicleId}</strong>
        <span>${distanceM > 0 ? `${Math.round(distanceM)}m` : ""}</span>
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
  const peerMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  // Convert vehicle cartesian pose (x_m, y_m) to geodetic coordinates
  const vehicleCoords = cartesianToGeodetic(
    vehicle.x_m,
    vehicle.y_m,
    DEFAULT_CAMPUS_CONFIG.anchor,
  );

  const activePeers = world.v2x?.active_peers ?? [];

  // Initialize Leaflet map with high-performance canvas renderer & fast tile loading
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
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      preferCanvas: true,
    });

    // Fast-loading CARTO Dark Matter Tiles
    L.tileLayer(DEFAULT_CAMPUS_CONFIG.tiles.url, {
      subdomains: DEFAULT_CAMPUS_CONFIG.tiles.subdomains,
      maxZoom: DEFAULT_CAMPUS_CONFIG.tiles.maxZoom,
      updateWhenIdle: false,
      updateWhenZooming: true,
      keepBuffer: 6,
    }).addTo(map);

    // Initial primary vehicle marker
    const vehicleMarker = L.marker(initialCenter, {
      icon: createPrimaryVehicleIcon(vehicle.heading_deg, vehicle.vehicle_id || "YOU"),
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

        // Background glow polyline
        L.polyline(latLngs, {
          color: "#0284c7",
          weight: 7,
          opacity: 0.35,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);

        // Foreground animated dashed route
        const routePolyline = L.polyline(latLngs, {
          color: "#38bdf8",
          weight: 3.5,
          opacity: 0.95,
          dashArray: "8, 10",
          className: "animated-campus-route",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
        routeLayerRef.current = routePolyline;
      }
    }

    // Add Campus POIs
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
      peerMarkersRef.current.clear();
      routeLayerRef.current = null;
    };
  }, []);

  // Update primary vehicle position and heading smoothly
  useEffect(() => {
    if (!mapInstanceRef.current || !vehicleMarkerRef.current) return;

    const newLatLng: [number, number] = [vehicleCoords.lat, vehicleCoords.lng];
    vehicleMarkerRef.current.setLatLng(newLatLng);
    vehicleMarkerRef.current.setIcon(
      createPrimaryVehicleIcon(vehicle.heading_deg, vehicle.vehicle_id || "YOU"),
    );

    if (autoFollow) {
      mapInstanceRef.current.panTo(newLatLng, { animate: true, duration: 0.2 });
    }
  }, [vehicleCoords.lat, vehicleCoords.lng, vehicle.heading_deg, autoFollow, vehicle.vehicle_id]);

  // Update other peer drivers on the map
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
            peer.emergency_state,
          ),
          zIndexOffset: 800,
        }).addTo(map);
        peerMarkersRef.current.set(peer.vehicle_id, marker);
      } else {
        marker.setLatLng(peerLatLng);
        marker.setIcon(
          createPeerVehicleIcon(
            peer.heading_deg,
            peer.vehicle_id,
            peer.distance_m,
            peer.emergency_state,
          ),
        );
      }
    });

    // Remove old peer markers that left wireless range
    peerMarkersRef.current.forEach((marker, id) => {
      if (!currentPeerIds.has(id)) {
        map.removeLayer(marker);
        peerMarkersRef.current.delete(id);
      }
    });
  }, [activePeers]);

  // Invalidate map size on layout updates
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.invalidateSize();
    }
  });

  return (
    <div className="campus-minimap-round-wrapper" aria-label="Circular Campus Navigation Radar">
      {/* Sleek Circular Tactical Bezel with Compass Cardinal Points */}
      <div
        className="campus-minimap-round-container"
        onClick={onExpand}
        title="Click to open extended campus map view"
      >
        <div ref={mapContainerRef} className="campus-minimap-leaflet-round-container" />

        {/* Tactical Radar HUD Overlays */}
        <div className="campus-radar-sweep-beam" aria-hidden="true" />
        <div className="campus-radar-range-ring ring-1" aria-hidden="true" />
        <div className="campus-radar-range-ring ring-2" aria-hidden="true" />
        <div className="campus-radar-crosshair" aria-hidden="true" />

        {/* Compass Cardinal Points on the Black Border Ring */}
        <div className="compass-cardinal compass-north" aria-hidden="true">N</div>
        <div className="compass-cardinal compass-east" aria-hidden="true">E</div>
        <div className="compass-cardinal compass-south" aria-hidden="true">S</div>
        <div className="compass-cardinal compass-west" aria-hidden="true">W</div>

        {/* Top & Bottom Status Badges */}
        <div className="campus-round-hud-top">
          <span className="campus-peer-count-badge">
            {activePeers.length > 0 ? `${activePeers.length} PEERS` : "GPS ACTIVE"}
          </span>
        </div>

        <div className="campus-round-hud-bottom">
          <span className="campus-hud-coords-pill">
            {formatCoordinates(vehicleCoords, 4)}
          </span>
        </div>
      </div>

      {/* Recenter / Expand Controls */}
      <div className="campus-minimap-round-controls">
        {!autoFollow && (
          <button
            type="button"
            className="campus-round-control-btn recenter"
            title="Recenter radar on vehicle"
            onClick={(e) => {
              e.stopPropagation();
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
          className="campus-round-control-btn expand"
          title="Expand to Fullscreen Map"
          aria-label="Expand map"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Expand</span>
        </button>
      </div>
    </div>
  );
}
