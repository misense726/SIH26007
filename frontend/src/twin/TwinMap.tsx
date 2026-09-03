import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import type { FleetVehicleSummary, MapFeature, MineEdge, MineNetwork, MineNode, Point2D, WorldState } from "../types";
import { DEFAULT_CAMPUS_CONFIG, EMPTY_MAP_TILE } from "../maps/campusConfig";
import { cartesianToGeodetic } from "../maps/locationProvider";
import { primaryVehicleOrNull } from "../state/selectors";
import { fetchFleetVehicles, fetchMineNetwork } from "../api/mineApi";

const SVG_WIDTH = 760;
const SVG_HEIGHT = 480;
const PADDING = 38;

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
  const [mineNetwork, setMineNetwork] = useState<MineNetwork | null>(null);
  const [fleetSummaries, setFleetSummaries] = useState<Record<string, FleetVehicleSummary>>({});
  const leafletContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Load mine network & fleet summaries
  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        const net = await fetchMineNetwork();
        if (mounted) setMineNetwork(net);
      } catch {
        // use world reference map
      }
      try {
        const sums = await fetchFleetVehicles();
        if (mounted && sums.length > 0) {
          const map: Record<string, FleetVehicleSummary> = {};
          sums.forEach((s) => { map[s.vehicle_id] = s; });
          setFleetSummaries(map);
        }
      } catch {
        // fallback
      }
    }
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const features = world.reference_map?.features ?? [];
  const primaryVehicle = primaryVehicleOrNull(world);

  // Compile unified fleet trucks from world.vehicles
  const vehicleList = world.vehicles && world.vehicles.length > 0 ? world.vehicles : (primaryVehicle ? [primaryVehicle] : []);

  const allTrucks = useMemo(() => {
    const truckColors: Record<string, string> = {
      DUMPER_01: "#38bdf8",
      DUMPER_02: "#f59e0b",
      DUMPER_03: "#10b981",
      HAULER_04: "#a855f7",
    };

    return vehicleList.map((veh, idx) => {
      const summary = fleetSummaries[veh.vehicle_id];
      const isPrimary = veh.vehicle_id === world.primary_vehicle_id;
      const color = truckColors[veh.vehicle_id] ?? (idx % 2 === 0 ? "#38bdf8" : "#f59e0b");
      const payload = summary ? summary.payload_tonnes : 0;
      const isLoaded = payload > 10;
      const cycleState = summary ? summary.cycle_state : (veh.speed_mps > 0.5 ? "TRAVELLING" : "IDLE");

      return {
        vehicle_id: veh.vehicle_id,
        is_primary: isPrimary,
        x_m: veh.x_m,
        y_m: veh.y_m,
        heading_deg: veh.heading_deg,
        speed_mps: veh.speed_mps,
        speed_kmh: veh.speed_mps * 3.6,
        emergency_state: isPrimary ? world.emergency.state : (summary?.emergency_state ?? "SAFE"),
        color,
        label: isPrimary ? `${veh.vehicle_id} [PRIMARY]` : (summary?.callsign ?? veh.vehicle_id),
        payload_tonnes: payload,
        is_loaded: isLoaded,
        cycle_state: cycleState,
      };
    });
  }, [vehicleList, fleetSummaries, world.primary_vehicle_id, world.emergency.state]);

  // Compute dynamic bounding box across reference map and mine nodes
  const bounds = useMemo(() => {
    let minX = 0;
    let maxX = 85;
    let minY = 0;
    let maxY = 45;

    // Expand to cover features
    features.forEach((feat) => {
      feat.points.forEach((pt) => {
        if (pt.x_m < minX) minX = pt.x_m;
        if (pt.x_m > maxX) maxX = pt.x_m;
        if (pt.y_m < minY) minY = pt.y_m;
        if (pt.y_m > maxY) maxY = pt.y_m;
      });
    });

    // Expand to cover mine network nodes
    if (mineNetwork) {
      Object.values(mineNetwork.nodes).forEach((node) => {
        if (node.x_m < minX) minX = node.x_m;
        if (node.x_m > maxX) maxX = node.x_m;
        if (node.y_m < minY) minY = node.y_m;
        if (node.y_m > maxY) maxY = node.y_m;
      });
    }

    // Expand to cover active vehicles
    allTrucks.forEach((t) => {
      if (t.x_m < minX) minX = t.x_m;
      if (t.x_m > maxX) maxX = t.x_m;
      if (t.y_m < minY) minY = t.y_m;
      if (t.y_m > maxY) maxY = t.y_m;
    });

    // Margins
    const dx = Math.max(20, maxX - minX);
    const dy = Math.max(20, maxY - minY);
    minX -= dx * 0.08;
    maxX += dx * 0.08;
    minY -= dy * 0.08;
    maxY += dy * 0.08;

    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);

    const scaleX = (SVG_WIDTH - PADDING * 2) / spanX;
    const scaleY = (SVG_HEIGHT - PADDING * 2) / spanY;
    const scale = Math.min(scaleX, scaleY);

    const usedW = spanX * scale;
    const usedH = spanY * scale;
    const offsetX = (SVG_WIDTH - usedW) / 2;
    const offsetY = (SVG_HEIGHT - usedH) / 2;

    return { minX, minY, scale, offsetX, offsetY };
  }, [features, mineNetwork, allTrucks]);

  // Coordinate transform function: Mine meters (x, y) -> SVG pixels (sx, sy)
  const toSvg = (x_m: number, y_m: number): { x: number; y: number } => {
    const sx = bounds.offsetX + (x_m - bounds.minX) * bounds.scale;
    const sy = SVG_HEIGHT - (bounds.offsetY + (y_m - bounds.minY) * bounds.scale);
    return { x: sx, y: sy };
  };

  const toSvgPointStr = (pt: Point2D): string => {
    const s = toSvg(pt.x_m, pt.y_m);
    return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
  };

  // Leaflet Road map integration
  useEffect(() => {
    if (viewMode !== "road" || !leafletContainerRef.current || leafletMapRef.current) return;

    const initialVehicle = allTrucks[0];
    const primaryGeo = initialVehicle
      ? cartesianToGeodetic(initialVehicle.x_m, initialVehicle.y_m, DEFAULT_CAMPUS_CONFIG.anchor)
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

  // Update Leaflet markers
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
      const safeSpeedKmh = truck.speed_kmh.toFixed(0);

      let marker = markersRef.current.get(truck.vehicle_id);
      if (!marker) {
        const icon = L.divIcon({
          className: "campus-vehicle-icon-wrap",
          html:
            `<div class="campus-navigation-pointer ${truck.is_primary ? "primary-driver" : "peer-driver"} ${isSelected ? "marker-selected" : ""}" style="transform: rotate(${safeHeading}deg);">` +
            `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path d="M16 3 L27 28 L16 23 L5 28 Z" fill="${truck.color}" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" /></svg></div>` +
            `<div class="campus-driver-label ${truck.is_primary ? "primary-label" : "peer-label"}"><strong>${escapeHtml(truck.label)}</strong>` +
            `<span class="campus-marker-speed">${safeSpeedKmh} km/h</span></div>`,
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
    <div className="supervisor-fleet-map-container" aria-label="NMDC Bailadila Fleet Digital Twin">
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
            All fleet ({allTrucks.length})
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
                <span className={`pill-payload-tag ${truck.is_loaded ? "loaded" : "empty"}`}>
                  {truck.is_loaded ? `${truck.payload_tonnes.toFixed(0)}T` : "0T"}
                </span>
                <small>{truck.speed_kmh.toFixed(0)} km/h</small>
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
            title="Show NMDC Bailadila Digital Twin Schematic"
          >
            Bailadila Mine Twin
          </button>
          <button
            type="button"
            className={`fleet-mode-btn ${viewMode === "road" ? "active" : ""}`}
            onClick={() => setViewMode("road")}
            aria-pressed={viewMode === "road"}
            title="Show Geographic Road Map"
          >
            Geo Satellite
          </button>
        </div>
      </div>

      {/* Main Map Viewport */}
      {viewMode === "schematic" ? (
        <div className="twin-map-schematic-wrap">
          <svg
            className="twin-map"
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            role="img"
            aria-label="NMDC Bailadila Mine Road Graph and Fleet Locations"
          >
            <defs>
              <pattern id="mine-grid-pattern" width="24" height="24" patternUnits="userSpaceOnUse">
                <path className="map-grid-line" d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.8" />
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

            {/* Background Grid */}
            <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#mine-grid-pattern)" rx="12" />

            {/* 1. Render Mine Road Network Edges with Status & Gradient Coloring */}
            {mineNetwork &&
              Object.values(mineNetwork.edges).map((edge) => {
                const fn = mineNetwork.nodes[edge.from_node];
                const tn = mineNetwork.nodes[edge.to_node];
                if (!fn || !tn) return null;

                const p1 = toSvg(fn.x_m, fn.y_m);
                const p2 = toSvg(tn.x_m, tn.y_m);

                // Status color
                const strokeColor =
                  edge.road_status === "OPEN"
                    ? "#10b981"
                    : edge.road_status === "RESTRICTED"
                    ? "#f59e0b"
                    : "#ef4444";
                const isClosed = edge.road_status === "CLOSED";

                // Midpoint for gradient tag
                const mx = (p1.x + p2.x) / 2;
                const my = (p1.y + p2.y) / 2;

                return (
                  <g key={edge.edge_id} className={`mine-edge-group status-${edge.road_status.toLowerCase()}`}>
                    {/* Road bed corridor */}
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={strokeColor}
                      strokeWidth={edge.lanes >= 2 ? 8.5 : 5.5}
                      strokeOpacity={isClosed ? 0.25 : 0.35}
                      strokeLinecap="round"
                    />
                    {/* Centerline */}
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={strokeColor}
                      strokeWidth={isClosed ? 2.5 : 1.8}
                      strokeDasharray={isClosed ? "6 5" : "none"}
                    />
                    {/* Gradient & Segment Badge */}
                    {Math.abs(edge.gradient_pct) >= 4.0 && (
                      <g transform={`translate(${mx}, ${my - 6})`}>
                        <rect
                          x="-26"
                          y="-7"
                          width="52"
                          height="12"
                          rx="3"
                          fill="rgba(10, 15, 26, 0.85)"
                          stroke={strokeColor}
                          strokeWidth="0.8"
                        />
                        <text
                          x="0"
                          y="1.5"
                          textAnchor="middle"
                          fontSize="6.5"
                          fill={strokeColor}
                          fontFamily="monospace"
                          fontWeight="700"
                        >
                          {edge.gradient_pct > 0 ? `+${edge.gradient_pct}%` : `${edge.gradient_pct}%`}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

            {/* Reference Map fallback features if no mine network */}
            {!mineNetwork &&
              features.map((feature) => {
                if (feature.geometry_type === "POLYGON") {
                  const ptsStr = feature.points.map(toSvgPointStr).join(" ");
                  return (
                    <polygon
                      key={feature.feature_id}
                      points={ptsStr}
                      className={`map-feature map-${feature.feature_type.toLowerCase().replace("_", "-")}`}
                    />
                  );
                }
                if (feature.geometry_type === "POLYLINE") {
                  const ptsStr = feature.points.map(toSvgPointStr).join(" ");
                  return (
                    <polyline
                      key={feature.feature_id}
                      points={ptsStr}
                      className={`map-feature map-${feature.feature_type.toLowerCase().replace("_", "-")}`}
                    />
                  );
                }
                return null;
              })}

            {/* 2. Render Mine Network Nodes (Benches, Dumps, Junctions) */}
            {mineNetwork &&
              Object.values(mineNetwork.nodes).map((node) => {
                const pt = toSvg(node.x_m, node.y_m);
                const isBench = node.node_type === "BENCH";
                const isDump = node.node_type === "DUMP";
                const isJunction = node.node_type === "JUNCTION";

                return (
                  <g key={node.node_id} transform={`translate(${pt.x}, ${pt.y})`} className="mine-node-marker">
                    {isBench && (
                      <g>
                        <circle r="9" fill="#0284c7" stroke="#38bdf8" strokeWidth="2" opacity="0.9" />
                        <text y="3" textAnchor="middle" fontSize="8" fill="#ffffff" fontWeight="800">⛏</text>
                        <text y="-12" textAnchor="middle" fontSize="7.5" fill="#38bdf8" fontWeight="700" fontFamily="sans-serif">
                          {node.name.replace(" Shovel #04", "").replace(" Shovel #02", "")}
                        </text>
                      </g>
                    )}
                    {isDump && (
                      <g>
                        <circle r="9" fill="#d97706" stroke="#f59e0b" strokeWidth="2" opacity="0.9" />
                        <text y="3" textAnchor="middle" fontSize="8" fill="#ffffff" fontWeight="800">⚙</text>
                        <text y="-12" textAnchor="middle" fontSize="7.5" fill="#f59e0b" fontWeight="700" fontFamily="sans-serif">
                          {node.name.replace(" Gyratory", "").replace(" Overburden", "")}
                        </text>
                      </g>
                    )}
                    {isJunction && (
                      <g>
                        <circle r="3.5" fill="#475569" stroke="#94a3b8" strokeWidth="1" />
                        <text y="9" textAnchor="middle" fontSize="6" fill="#94a3b8" fontFamily="monospace">
                          {node.node_id.replace("J_HAUL_", "J")}
                        </text>
                      </g>
                    )}
                    {node.node_type === "WAYPOINT" && (
                      <g>
                        <circle r="2.5" fill="#64748b" opacity="0.6" />
                        <text y="7" textAnchor="middle" fontSize="5" fill="#64748b" fontFamily="monospace">
                          {node.node_id.replace("WP_", "")}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

            {/* 3. Render All Fleet Vehicles */}
            {allTrucks.map((truck) => {
              const pt = toSvg(truck.x_m, truck.y_m);
              const isSelected = selectedTruckId === truck.vehicle_id;
              const isAlert = truck.emergency_state && truck.emergency_state !== "SAFE";

              return (
                <g
                  key={truck.vehicle_id}
                  className={`map-truck-group ${isSelected ? "truck-selected" : ""}`}
                  transform={`translate(${pt.x}, ${pt.y})`}
                  onClick={() => onSelectTruck?.(truck.vehicle_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectTruck?.(truck.vehicle_id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${truck.label} on mine twin`}
                  style={{ cursor: "pointer" }}
                >
                  {/* Selection Highlight Ring */}
                  {isSelected && (
                    <circle
                      cx="0"
                      cy="0"
                      r="22"
                      fill="none"
                      stroke={truck.color}
                      strokeWidth="2.2"
                      strokeDasharray="5 3"
                      className="truck-selection-ring"
                    />
                  )}

                  {/* Directional Truck Body */}
                  <g
                    transform={`rotate(${truck.heading_deg})`}
                    filter={truck.is_primary ? "url(#lead-glow)" : "url(#peer-glow)"}
                  >
                    {/* Chassis */}
                    <rect
                      x="-7"
                      y="-13"
                      width="14"
                      height="24"
                      rx="3"
                      fill="#0b1120"
                      stroke={truck.color}
                      strokeWidth="1.8"
                    />
                    {/* Directional pointer cab */}
                    <path d="M 0 -15 L 6 -6 L -6 -6 Z" fill={truck.color} />
                    {/* Windshield */}
                    <rect x="-5" y="-10" width="10" height="4.5" rx="1" fill={truck.color} opacity="0.9" />
                    {/* Haul Cargo Bed */}
                    <rect
                      x="-5"
                      y="-3"
                      width="10"
                      height="12"
                      rx="1.5"
                      fill={isAlert ? "#ef4444" : truck.is_loaded ? "#f59e0b" : "#475569"}
                      opacity={truck.is_loaded ? 0.75 : 0.35}
                    />
                  </g>

                  {/* Callsign & Payload Tag Banner above vehicle */}
                  <g transform="translate(0, -20)">
                    <rect
                      x="-44"
                      y="-13"
                      width="88"
                      height="16"
                      rx="4"
                      fill="rgba(5, 10, 20, 0.94)"
                      stroke={isSelected ? "#ffffff" : truck.color}
                      strokeWidth={isSelected ? "1.8" : "1"}
                    />
                    <text
                      x="0"
                      y="-2"
                      textAnchor="middle"
                      fontSize="7"
                      fill={isSelected ? "#ffffff" : truck.color}
                      fontWeight="800"
                      fontFamily="monospace"
                    >
                      {truck.vehicle_id} {truck.is_loaded ? `[${truck.payload_tonnes.toFixed(0)}T]` : "[EMPTY]"}
                    </text>
                  </g>

                  {/* Speed & State Tag below vehicle */}
                  <g transform="translate(0, 18)">
                    <rect
                      x="-30"
                      y="-9"
                      width="60"
                      height="12"
                      rx="3"
                      fill="rgba(15, 23, 42, 0.90)"
                      stroke="rgba(255, 255, 255, 0.18)"
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
                      {truck.speed_kmh.toFixed(0)} km/h • {truck.cycle_state.replace("TRAVELLING_TO_", "TO ")}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="leaflet-map-host" ref={leafletContainerRef} />
      )}
    </div>
  );
}
