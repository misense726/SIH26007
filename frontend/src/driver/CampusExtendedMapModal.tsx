import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { VehiclePose, WorldState } from "../types";
import { DEFAULT_CAMPUS_CONFIG, EMPTY_MAP_TILE } from "../maps/campusConfig";
import { cartesianToGeodetic, formatCoordinates } from "../maps/locationProvider";
import { formatNumber } from "../state/selectors";

interface CampusExtendedMapModalProps {
  world: WorldState;
  vehicle: VehiclePose;
  telemetryConnected: boolean;
  onClose: () => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

function normalizedHeading(headingDeg: number): number {
  return ((headingDeg % 360) + 360) % 360;
}

function createVehicleIcon(
  headingDeg: number,
  vehicleId: string,
  kind: "primary" | "peer",
  isEmergency = false,
) {
  const primary = kind === "primary";
  const fill = isEmergency ? "#dc2626" : primary ? "#0284c7" : "#d97706";
  const labelClass = primary ? "primary-label" : "peer-label";
  const pointerClass = primary ? "primary-driver" : "peer-driver";
  const html =
    '<div class="campus-navigation-pointer campus-navigation-pointer-large ' +
    pointerClass +
    '" style="transform: rotate(' +
    normalizedHeading(headingDeg) +
    'deg);"><svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">' +
    '<path d="M18 3 L31 32 L18 26 L5 32 Z" fill="' +
    fill +
    '" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round" /></svg></div>' +
    '<span class="campus-driver-label ' +
    labelClass +
    ' extended-driver-label">' +
    escapeHtml(vehicleId) +
    "</span>";

  return L.divIcon({
    className: "campus-vehicle-icon-wrap",
    html,
    iconSize: [92, 58],
    iconAnchor: [46, 18],
  });
}

function updateMarkerHeading(marker: L.Marker, headingDeg: number): void {
  const pointer = marker
    .getElement()
    ?.querySelector<HTMLElement>(".campus-navigation-pointer");
  if (pointer) {
    pointer.style.transform = "rotate(" + normalizedHeading(headingDeg) + "deg)";
  }
}

function updatePeerMarkerAppearance(marker: L.Marker, emergencyState: string): void {
  const isEmergency = Boolean(emergencyState && emergencyState !== "SAFE");
  const path = marker.getElement()?.querySelector<SVGPathElement>(".campus-navigation-pointer path");
  path?.setAttribute("fill", isEmergency ? "#dc2626" : "#d97706");
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
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const [showRoute, setShowRoute] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);

  const vehicleCoords = cartesianToGeodetic(
    vehicle.x_m,
    vehicle.y_m,
    DEFAULT_CAMPUS_CONFIG.anchor,
  );
  const activePeers = world.v2x?.active_peers ?? [];
  const corridorState = telemetryConnected ? world.safe_corridor.state : "GREY";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

    L.control.zoom({ position: "topleft" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    L.tileLayer(DEFAULT_CAMPUS_CONFIG.tiles.url, {
      attribution: DEFAULT_CAMPUS_CONFIG.tiles.attribution,
      subdomains: DEFAULT_CAMPUS_CONFIG.tiles.subdomains,
      maxNativeZoom: DEFAULT_CAMPUS_CONFIG.tiles.maxZoom,
      maxZoom: DEFAULT_CAMPUS_CONFIG.maxZoom,
      errorTileUrl: EMPTY_MAP_TILE,
      updateWhenIdle: true,
      keepBuffer: 4,
    }).addTo(map);

    const vehicleMarker = L.marker(initialCenter, {
      icon: createVehicleIcon(
        vehicle.heading_deg,
        vehicle.vehicle_id || "DUMPER_01",
        "primary",
      ),
      zIndexOffset: 1000,
    }).addTo(map);
    vehicleMarkerRef.current = vehicleMarker;

    const routeFeature = world.reference_map?.features.find(
      (feature) => feature.feature_type === "ROUTE",
    );
    if (routeFeature && routeFeature.points.length > 1) {
      const route = routeFeature.points.map((point): [number, number] => {
        const coordinates = cartesianToGeodetic(
          point.x_m,
          point.y_m,
          DEFAULT_CAMPUS_CONFIG.anchor,
        );
        return [coordinates.lat, coordinates.lng];
      });
      const routeBacking = L.polyline(route, {
        color: "#ffffff",
        weight: 9,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      });
      const routeLine = L.polyline(route, {
        color: "#0284c7",
        weight: 5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      });
      routeLayerRef.current = L.layerGroup([routeBacking, routeLine]).addTo(map);
    }

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

  useEffect(() => {
    const map = mapInstanceRef.current;
    const marker = vehicleMarkerRef.current;
    if (!map || !marker) return;

    const nextPosition = L.latLng(vehicleCoords.lat, vehicleCoords.lng);
    marker.setLatLng(nextPosition);
    updateMarkerHeading(marker, vehicle.heading_deg);

    if (autoFollow && map.getCenter().distanceTo(nextPosition) > 12) {
      map.panTo(nextPosition, { animate: true, duration: 0.4 });
    }
  }, [vehicleCoords.lat, vehicleCoords.lng, vehicle.heading_deg, autoFollow]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentPeerIds = new Set<string>();
    activePeers.forEach((peer) => {
      currentPeerIds.add(peer.vehicle_id);
      const peerCoordinates = cartesianToGeodetic(
        peer.x_m,
        peer.y_m,
        DEFAULT_CAMPUS_CONFIG.anchor,
      );
      const peerPosition: [number, number] = [peerCoordinates.lat, peerCoordinates.lng];
      const isEmergency = Boolean(peer.emergency_state && peer.emergency_state !== "SAFE");
      let marker = peerMarkersRef.current.get(peer.vehicle_id);

      if (!marker) {
        marker = L.marker(peerPosition, {
          icon: createVehicleIcon(
            peer.heading_deg,
            peer.vehicle_id,
            "peer",
            isEmergency,
          ),
          zIndexOffset: 800,
        }).addTo(map);
        peerMarkersRef.current.set(peer.vehicle_id, marker);
      } else {
        marker.setLatLng(peerPosition);
        updateMarkerHeading(marker, peer.heading_deg);
        updatePeerMarkerAppearance(marker, String(peer.emergency_state));
      }
    });

    peerMarkersRef.current.forEach((marker, id) => {
      if (!currentPeerIds.has(id)) {
        map.removeLayer(marker);
        peerMarkersRef.current.delete(id);
      }
    });
  }, [activePeers]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const route = routeLayerRef.current;
    if (!map || !route) return;
    if (showRoute) route.addTo(map);
    else map.removeLayer(route);
  }, [showRoute]);

  function focusVehicle(lat: number, lng: number) {
    setAutoFollow(false);
    mapInstanceRef.current?.setView(
      [lat, lng],
      DEFAULT_CAMPUS_CONFIG.extendedZoom,
      { animate: true },
    );
  }

  return (
    <div className="campus-modal-backdrop" onClick={onClose}>
      <div
        className="campus-extended-modal-container"
        role="dialog"
        aria-modal="true"
        aria-label={"Route map for " + DEFAULT_CAMPUS_CONFIG.locationLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="campus-modal-header">
          <div className="campus-modal-title-wrap">
            <span className="source-badge">Navigation</span>
            <div>
              <h2>{DEFAULT_CAMPUS_CONFIG.locationLabel}</h2>
              <span className="campus-header-coords">
                {formatCoordinates(vehicleCoords, 5)}
              </span>
            </div>
          </div>

          <div className="campus-modal-toolbar">
            <button
              type="button"
              className={"campus-tool-btn " + (autoFollow ? "active" : "")}
              onClick={() => {
                setAutoFollow(true);
                mapInstanceRef.current?.setView(
                  [vehicleCoords.lat, vehicleCoords.lng],
                  DEFAULT_CAMPUS_CONFIG.extendedZoom,
                  { animate: true },
                );
              }}
            >
              {autoFollow ? "Following vehicle" : "Follow vehicle"}
            </button>
            <button
              type="button"
              className={"campus-tool-btn " + (showRoute ? "active" : "")}
              onClick={() => setShowRoute((visible) => !visible)}
            >
              {showRoute ? "Hide route" : "Show route"}
            </button>
            <button
              type="button"
              className="campus-modal-close-btn"
              onClick={onClose}
              aria-label="Close route map"
            >
              Close
            </button>
          </div>
        </div>

        <div className="campus-extended-body">
          <div className="campus-modal-map-stage">
            <div ref={mapContainerRef} className="campus-extended-leaflet-container" />
            <div className="campus-modal-hud-overlay">
              <div className="campus-hud-item">
                <span>Speed</span>
                <strong>{telemetryConnected ? formatNumber(vehicle.speed_mps * 3.6, 1) + " km/h" : "--"}</strong>
              </div>
              <div className="campus-hud-item">
                <span>Heading</span>
                <strong>{telemetryConnected ? formatNumber(vehicle.heading_deg, 0) + "°" : "--"}</strong>
              </div>
              <div className="campus-hud-item">
                <span>Safe corridor</span>
                <strong className={"corridor-" + corridorState.toLowerCase()}>{corridorState}</strong>
              </div>
              <div className="campus-hud-item">
                <span>Nearby vehicles</span>
                <strong>{activePeers.length}</strong>
              </div>
            </div>
          </div>

          <aside className="campus-peers-sidebar">
            <div className="campus-peers-header">
              <h3>Nearby vehicles</h3>
              <span className="v2x-stat-pill">{activePeers.length + 1} tracked</span>
            </div>

            <div className="campus-driver-cards-list">
              <button
                type="button"
                className="campus-driver-row primary-row"
                onClick={() => focusVehicle(vehicleCoords.lat, vehicleCoords.lng)}
              >
                <div className="campus-driver-row-top">
                  <strong>{vehicle.vehicle_id || "DUMPER_01"}</strong>
                  <span className="driver-role-badge primary">This vehicle</span>
                </div>
                <div className="campus-driver-row-stats">
                  <span>{(vehicle.speed_mps * 3.6).toFixed(1)} km/h</span>
                  <span>{Math.round(vehicle.heading_deg)}°</span>
                </div>
              </button>

              {activePeers.map((peer) => {
                const peerCoordinates = cartesianToGeodetic(
                  peer.x_m,
                  peer.y_m,
                  DEFAULT_CAMPUS_CONFIG.anchor,
                );
                return (
                  <button
                    type="button"
                    key={peer.vehicle_id}
                    className="campus-driver-row"
                    onClick={() => focusVehicle(peerCoordinates.lat, peerCoordinates.lng)}
                  >
                    <div className="campus-driver-row-top">
                      <strong>{peer.vehicle_id}</strong>
                      <span className={"link-badge link-" + peer.link_status.toLowerCase()}>
                        {peer.link_status}
                      </span>
                    </div>
                    <div className="campus-driver-row-stats">
                      <span>{peer.distance_m} m away</span>
                      <span>{(peer.speed_mps * 3.6).toFixed(1)} km/h</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
