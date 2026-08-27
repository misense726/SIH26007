import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { VehiclePose, WorldState } from "../types";
import { DEFAULT_CAMPUS_CONFIG, EMPTY_MAP_TILE } from "../maps/campusConfig";
import { cartesianToGeodetic } from "../maps/locationProvider";

interface CampusMinimapProps {
  world: WorldState;
  vehicle: VehiclePose;
  onExpand: () => void;
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
    '<div class="campus-navigation-pointer ' +
    pointerClass +
    '" style="transform: rotate(' +
    normalizedHeading(headingDeg) +
    'deg);"><svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">' +
    '<path d="M16 3 L27 28 L16 23 L5 28 Z" fill="' +
    fill +
    '" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" /></svg></div>' +
    '<span class="campus-driver-label ' +
    labelClass +
    '">' +
    escapeHtml(vehicleId) +
    "</span>";

  return L.divIcon({
    className: "campus-vehicle-icon-wrap",
    html,
    iconSize: [76, 50],
    iconAnchor: [38, 16],
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

export function CampusMinimap({ world, vehicle, onExpand }: CampusMinimapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const peerMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [autoFollow, setAutoFollow] = useState(true);

  const vehicleCoords = cartesianToGeodetic(
    vehicle.x_m,
    vehicle.y_m,
    DEFAULT_CAMPUS_CONFIG.anchor,
  );
  const activePeers = world.v2x?.active_peers ?? [];

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

    L.tileLayer(DEFAULT_CAMPUS_CONFIG.tiles.url, {
      subdomains: DEFAULT_CAMPUS_CONFIG.tiles.subdomains,
      maxNativeZoom: DEFAULT_CAMPUS_CONFIG.tiles.maxZoom,
      maxZoom: DEFAULT_CAMPUS_CONFIG.maxZoom,
      errorTileUrl: EMPTY_MAP_TILE,
      updateWhenIdle: true,
      keepBuffer: 3,
    }).addTo(map);

    const vehicleMarker = L.marker(initialCenter, {
      icon: createVehicleIcon(
        vehicle.heading_deg,
        vehicle.vehicle_id || "DUMPER_01",
        "primary",
      ),
      interactive: false,
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

      L.polyline(route, {
        color: "#ffffff",
        weight: 7,
        opacity: 0.88,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(map);
      L.polyline(route, {
        color: "#0284c7",
        weight: 4,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(map);
    }

    map.on("dragstart", () => setAutoFollow(false));
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      vehicleMarkerRef.current = null;
      peerMarkersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const marker = vehicleMarkerRef.current;
    if (!map || !marker) return;

    const nextPosition = L.latLng(vehicleCoords.lat, vehicleCoords.lng);
    marker.setLatLng(nextPosition);
    updateMarkerHeading(marker, vehicle.heading_deg);

    if (autoFollow && map.getCenter().distanceTo(nextPosition) > 8) {
      map.panTo(nextPosition, { animate: true, duration: 0.35 });
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
          interactive: false,
          zIndexOffset: 800,
        }).addTo(map);
        peerMarkersRef.current.set(peer.vehicle_id, marker);
      } else {
        marker.setLatLng(peerPosition);
        updateMarkerHeading(marker, peer.heading_deg);
      }
    });

    peerMarkersRef.current.forEach((marker, id) => {
      if (!currentPeerIds.has(id)) {
        map.removeLayer(marker);
        peerMarkersRef.current.delete(id);
      }
    });
  }, [activePeers]);

  return (
    <div
      className="campus-navigation-widget"
      aria-label={"Road navigation near " + DEFAULT_CAMPUS_CONFIG.locationLabel}
    >
      <div
        className="campus-navigation-map"
        onClick={onExpand}
        title="Open route map"
      >
        <div ref={mapContainerRef} className="campus-navigation-map-canvas" />
        <div className="campus-navigation-location" aria-hidden="true">
          <strong>{DEFAULT_CAMPUS_CONFIG.locationCode}</strong>
          <span>Chennai</span>
        </div>
        <button
          type="button"
          className="campus-navigation-expand"
          aria-label="Open route map"
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {!autoFollow && (
        <button
          type="button"
          className="campus-navigation-recenter"
          onClick={() => {
            setAutoFollow(true);
            mapInstanceRef.current?.setView(
              [vehicleCoords.lat, vehicleCoords.lng],
              DEFAULT_CAMPUS_CONFIG.minimapZoom,
              { animate: true },
            );
          }}
        >
          Recenter
        </button>
      )}
    </div>
  );
}
