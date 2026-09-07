import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { DEFAULT_CAMPUS_CONFIG, EMPTY_MAP_TILE } from "../maps/campusConfig";
import { cartesianToGeodetic } from "../maps/locationProvider";
import type { SupervisorVehicle } from "../supervisor/supervisorViewModel";
import type { DataMode, HaulRouteState, MapFeature, Point2D } from "../types";
import { MineFleetMap } from "./MineFleetMap";
import { ReferenceMapLegend } from "./ReferenceMapLegend";

const WIDTH = 960;
const HEIGHT = 520;
const PADDING = 42;

interface Projection {
  point: (value: Point2D) => [number, number];
  scale: number;
}

function createProjection(features: MapFeature[], vehicles: SupervisorVehicle[]): Projection {
  const points = [
    ...features.flatMap((feature) => feature.points),
    ...vehicles.map((vehicle) => ({ x_m: vehicle.xM, y_m: vehicle.yM })),
  ];
  const safePoints = points.length > 0 ? points : [{ x_m: 0, y_m: 0 }];
  const minX = Math.min(...safePoints.map((point) => point.x_m));
  const maxX = Math.max(...safePoints.map((point) => point.x_m));
  const minY = Math.min(...safePoints.map((point) => point.y_m));
  const maxY = Math.max(...safePoints.map((point) => point.y_m));
  const spanX = Math.max(maxX - minX, 20);
  const spanY = Math.max(maxY - minY, 20);
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);
  const renderedWidth = spanX * scale;
  const renderedHeight = spanY * scale;
  const offsetX = (WIDTH - renderedWidth) / 2;
  const offsetY = (HEIGHT - renderedHeight) / 2;

  return {
    scale,
    point: (value) => [
      offsetX + (value.x_m - minX) * scale,
      HEIGHT - offsetY - (value.y_m - minY) * scale,
    ],
  };
}

function featureClassName(feature: MapFeature): string {
  return `map-feature map-${feature.feature_type.toLowerCase().replaceAll("_", "-")}`;
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

function vehicleColor(vehicle: SupervisorVehicle): string {
  return vehicle.isPrimary ? "var(--fleet-primary)" : "var(--fleet-peer)";
}

function statusColor(vehicle: SupervisorVehicle): string {
  if (vehicle.tone === "critical" || vehicle.tone === "lost") return "var(--danger)";
  if (vehicle.tone === "attention" || vehicle.tone === "unknown") return "var(--warning)";
  return "var(--safe)";
}

interface TwinMapProps {
  mode: DataMode;
  haul?: HaulRouteState | null;
  vehicles: SupervisorVehicle[];
  features: MapFeature[];
  mapName: string;
  selectedTruckId?: string | null;
  onSelectTruck?: (truckId: string | null) => void;
}

export function TwinMap(props: TwinMapProps) {
  return props.mode === "SIMULATED" && props.haul
    ? <MineFleetMap {...props} />
    : <StandardTwinMap {...props} />;
}

function StandardTwinMap({
  vehicles,
  features,
  mapName,
  selectedTruckId,
  onSelectTruck,
}: TwinMapProps) {
  const [viewMode, setViewMode] = useState<"schematic" | "road">("schematic");
  const leafletContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const featuresRef = useRef(features);
  const hasFittedRoadMapRef = useRef(false);
  const lastPannedTruckIdRef = useRef<string | null>(null);
  featuresRef.current = features;

  const projection = useMemo(() => createProjection(features, vehicles), [features, vehicles]);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.vehicleId === selectedTruckId) ?? null;

  useEffect(() => {
    if (viewMode !== "road" || !leafletContainerRef.current || leafletMapRef.current) return;

    const map = L.map(leafletContainerRef.current, {
      center: [DEFAULT_CAMPUS_CONFIG.siteCenter.lat, DEFAULT_CAMPUS_CONFIG.siteCenter.lng],
      zoom: DEFAULT_CAMPUS_CONFIG.extendedZoom,
      minZoom: DEFAULT_CAMPUS_CONFIG.minZoom,
      maxZoom: DEFAULT_CAMPUS_CONFIG.maxZoom,
      zoomControl: true,
      attributionControl: true,
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

    featuresRef.current.forEach((feature) => {
      const geoPoints = feature.points.map((point) => {
        const geo = cartesianToGeodetic(point.x_m, point.y_m, DEFAULT_CAMPUS_CONFIG.anchor);
        return [geo.lat, geo.lng] as L.LatLngTuple;
      });
      if (geoPoints.length === 0) return;

      if (feature.geometry_type === "POLYGON") {
        L.polygon(geoPoints, {
          color: feature.feature_type === "HAZARD_ZONE" ? "#d03b3b" : "#6b7f8f",
          fillColor: feature.feature_type === "HAZARD_ZONE" ? "#d03b3b" : "#6b7f8f",
          fillOpacity: feature.feature_type === "HAZARD_ZONE" ? 0.18 : 0.08,
          weight: 2,
        }).addTo(map);
      } else if (feature.geometry_type === "POLYLINE") {
        L.polyline(geoPoints, {
          color: feature.feature_type === "ROUTE" ? "#3987e5" : "#7f93a3",
          opacity: feature.feature_type === "ROUTE" ? 0.95 : 0.55,
          weight: feature.feature_type === "ROUTE" ? 4 : 2,
          dashArray: feature.feature_type === "CENTERLINE" ? "8 8" : undefined,
        }).addTo(map);
      }
    });

    leafletMapRef.current = map;
    hasFittedRoadMapRef.current = false;

    return () => {
      map.remove();
      leafletMapRef.current = null;
      markersRef.current.clear();
      hasFittedRoadMapRef.current = false;
      lastPannedTruckIdRef.current = null;
    };
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "road" || !leafletMapRef.current) return;
    const map = leafletMapRef.current;
    const currentIds = new Set<string>();
    const positions: L.LatLngTuple[] = [];

    vehicles.forEach((vehicle) => {
      currentIds.add(vehicle.vehicleId);
      const geo = cartesianToGeodetic(vehicle.xM, vehicle.yM, DEFAULT_CAMPUS_CONFIG.anchor);
      const latLng: L.LatLngTuple = [geo.lat, geo.lng];
      positions.push(latLng);
      const isSelected = selectedTruckId === vehicle.vehicleId;
      const safeHeading = Number.isFinite(vehicle.headingDeg) ? vehicle.headingDeg : 0;
      const color = vehicle.isPrimary ? "var(--fleet-primary)" : "var(--fleet-peer)";
      const outline = statusColor(vehicle);

      let marker = markersRef.current.get(vehicle.vehicleId);
      if (!marker) {
        const icon = L.divIcon({
          className: "fleet-map-marker-wrap",
          html:
            '<div class="fleet-map-pointer ' +
            (vehicle.isPrimary ? "fleet-map-pointer-primary" : "fleet-map-pointer-peer") +
            (isSelected ? " marker-selected" : "") +
            '" style="--marker-color:' + color + ";--marker-outline:" + outline +
            ";transform:rotate(" + safeHeading +
            'deg)"><svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path d="M16 3 L27 28 L16 23 L5 28 Z" /></svg></div>' +
            '<div class="fleet-map-label"><strong>' + escapeHtml(vehicle.vehicleId) +
            "</strong><span>" + escapeHtml(vehicle.isPrimary ? "PRIMARY" : vehicle.tone.toUpperCase()) +
            "</span></div>",
          iconSize: [108, 58],
          iconAnchor: [54, 18],
        });
        marker = L.marker(latLng, {
          icon,
          title: vehicle.vehicleId,
          zIndexOffset: vehicle.isPrimary ? 1000 : 800,
        }).addTo(map);
        marker.on("click", () => onSelectTruck?.(vehicle.vehicleId));
        markersRef.current.set(vehicle.vehicleId, marker);
      } else {
        marker.setLatLng(latLng);
        const element = marker.getElement();
        const pointer = element?.querySelector<HTMLElement>(".fleet-map-pointer");
        if (pointer) {
          pointer.style.transform = `rotate(${safeHeading}deg)`;
          pointer.style.setProperty("--marker-color", color);
          pointer.style.setProperty("--marker-outline", outline);
          pointer.classList.toggle("marker-selected", isSelected);
        }
        const status = element?.querySelector<HTMLElement>(".fleet-map-label span");
        if (status) status.textContent = vehicle.isPrimary ? "PRIMARY" : vehicle.tone.toUpperCase();
      }
    });

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
      }
    });

    if (!selectedVehicle) lastPannedTruckIdRef.current = null;

    if (selectedVehicle && lastPannedTruckIdRef.current !== selectedVehicle.vehicleId) {
      const selectedGeo = cartesianToGeodetic(
        selectedVehicle.xM,
        selectedVehicle.yM,
        DEFAULT_CAMPUS_CONFIG.anchor,
      );
      map.panTo([selectedGeo.lat, selectedGeo.lng], { animate: true });
      lastPannedTruckIdRef.current = selectedVehicle.vehicleId;
    } else if (!selectedVehicle && !hasFittedRoadMapRef.current && positions.length > 0) {
      lastPannedTruckIdRef.current = null;
      map.fitBounds(L.latLngBounds(positions), { padding: [44, 44], maxZoom: 19 });
      hasFittedRoadMapRef.current = true;
    }
  }, [viewMode, vehicles, selectedTruckId, selectedVehicle, onSelectTruck]);

  return (
    <div className="supervisor-fleet-map-container" aria-label="Fleet map">
      <div className="fleet-map-toolbar">
        <div className="fleet-map-context">
          <span className="fleet-map-live-dot" aria-hidden="true" />
          <span>{selectedVehicle ? `Focused on ${selectedVehicle.vehicleId}` : `${vehicles.length} known vehicles`}</span>
        </div>
        <div className="fleet-view-mode-toggle" role="group" aria-label="Map display mode">
          <button
            type="button"
            className={viewMode === "schematic" ? "active" : ""}
            onClick={() => setViewMode("schematic")}
            aria-pressed={viewMode === "schematic"}
          >
            Site plan
          </button>
          <button
            type="button"
            className={viewMode === "road" ? "active" : ""}
            onClick={() => setViewMode("road")}
            aria-pressed={viewMode === "road"}
          >
            Road map
          </button>
        </div>
      </div>

      {viewMode === "schematic" ? (
        <div className="twin-map-schematic-wrap">
          <svg
            className="twin-map"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${mapName} site plan with ${vehicles.length} fleet vehicles`}
          >
            <defs>
              <pattern id="supervisor-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <path className="map-grid-line" d="M 28 0 L 0 0 0 28" fill="none" />
              </pattern>
              <filter id="vehicle-shadow" x="-80%" y="-80%" width="260%" height="260%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.45" />
              </filter>
            </defs>
            <rect width={WIDTH} height={HEIGHT} fill="url(#supervisor-grid)" rx="22" />

            {features.map((feature) => {
              const projected = feature.points.map(projection.point);
              const points = projected.map(([x, y]) => `${x},${y}`).join(" ");
              if (feature.geometry_type === "POLYGON") {
                return <polygon key={feature.feature_id} points={points} className={featureClassName(feature)} />;
              }
              if (feature.geometry_type === "POLYLINE") {
                return <polyline key={feature.feature_id} points={points} className={featureClassName(feature)} />;
              }
              const location = projected[0];
              if (!location) return null;
              return (
                <g key={feature.feature_id} className={featureClassName(feature)}>
                  <circle cx={location[0]} cy={location[1]} r={6} />
                  <title>{feature.label}</title>
                </g>
              );
            })}

            {vehicles.map((vehicle) => {
              const [x, y] = projection.point({ x_m: vehicle.xM, y_m: vehicle.yM });
              const selected = selectedTruckId === vehicle.vehicleId;
              const color = vehicleColor(vehicle);
              const outline = statusColor(vehicle);
              const markerSize = Math.max(12, Math.min(20, projection.scale * 1.15));

              return (
                <g
                  key={vehicle.vehicleId}
                  className={`map-truck-group map-truck-${vehicle.tone} ${selected ? "truck-selected" : ""}`}
                  transform={`translate(${x} ${y})`}
                  onClick={() => onSelectTruck?.(vehicle.vehicleId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectTruck?.(vehicle.vehicleId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${vehicle.vehicleId}, ${vehicle.tone.replaceAll("_", " ")}. View details`}
                >
                  {selected && (
                    <circle className="truck-selection-ring" r={markerSize + 12} stroke={color} />
                  )}
                  <circle className="truck-status-ring" r={markerSize + 5} stroke={outline} />
                  <g transform={`rotate(${vehicle.headingDeg})`} filter="url(#vehicle-shadow)">
                    <path
                      className="map-vehicle-body"
                      d={`M 0 ${-markerSize} L ${markerSize * 0.7} ${markerSize * 0.72} L 0 ${markerSize * 0.42} L ${-markerSize * 0.7} ${markerSize * 0.72} Z`}
                      fill={color}
                    />
                    <path
                      className="map-vehicle-cab"
                      d={`M ${-markerSize * 0.34} ${-markerSize * 0.3} L ${markerSize * 0.34} ${-markerSize * 0.3} L ${markerSize * 0.25} ${markerSize * 0.18} L ${-markerSize * 0.25} ${markerSize * 0.18} Z`}
                    />
                  </g>
                  <g className="map-vehicle-label" transform={`translate(0 ${markerSize + 28})`}>
                    <rect x="-47" y="-14" width="94" height="28" rx="7" />
                    <text y="-3" textAnchor="middle" dominantBaseline="middle">{vehicle.vehicleId}</text>
                    <text className="map-vehicle-label-status" y="7" textAnchor="middle" dominantBaseline="middle">
                      {vehicle.isPrimary ? "PRIMARY" : vehicle.tone.toUpperCase()}
                    </text>
                  </g>
                </g>
              );
            })}

            {vehicles.length === 0 && (
              <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="map-empty-label">
                No vehicle telemetry
              </text>
            )}
          </svg>
        </div>
      ) : (
        <div className="twin-map-road-wrap">
          <div ref={leafletContainerRef} className="fleet-leaflet-container" />
          <div className="fleet-road-hud">
            <strong>{mapName}</strong>
            <span>{selectedVehicle ? selectedVehicle.vehicleId : "All vehicles"}</span>
          </div>
        </div>
      )}
      <ReferenceMapLegend features={features} />
    </div>
  );
}
