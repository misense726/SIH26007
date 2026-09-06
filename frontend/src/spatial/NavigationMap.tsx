import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { VehiclePose, WorldState } from "../types";
import "./navigation.css";
import { MineCartography, planProjection } from "../maps/MineCartography";

export function NavigationMap({
  world,
  vehicle,
  connected,
}: {
  world: WorldState;
  vehicle: VehiclePose;
  connected: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [follow, setFollow] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [mapWidth, setMapWidth] = useState(1000);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setMapWidth(entry.contentRect.width),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const aspect = mapWidth < 680 ? 1.4 : 2.5;
  const features = world.reference_map?.features ?? [];
  const route = features.find((f) => f.feature_type === "ROUTE");
  const haul = world.haul_route;
  const bounds = useMemo(() => {
    const points = features.flatMap((f) => f.points);
    const xs = points.map((p) => p.x_m),
      ys = points.map((p) => -p.y_m);
    const minX = Math.min(0, ...xs) - 5,
      maxX = Math.max(10, ...xs) + 5;
    const minY = Math.min(0, ...ys) - 5,
      maxY = Math.max(10, ...ys) + 5;
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      width: Math.max(maxX - minX, (maxY - minY) * aspect),
    };
  }, [features, aspect]);
  const width = bounds.width / zoom,
    height = width / aspect;
  const center =
    follow && connected
      ? { x: vehicle.x_m, y: -vehicle.y_m }
      : { x: bounds.x + pan.x, y: bounds.y + pan.y };
  const markerScale = (width / Math.max(300, mapWidth)) * 6;
  const path = route?.points.map((p) => `${p.x_m},${-p.y_m}`).join(" ") ?? "";
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const size = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.current.x) * width) / size.width;
    const dy = ((event.clientY - drag.current.y) * width) / size.width;
    setPan((p) => ({
      x: p.x - dx,
      y: p.y - dy,
    }));
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  return (
    <section className="route-navigation" aria-label="Route navigation">
      <header
        className="route-guidance"
        data-phase={
          connected
            ? haul?.traffic_slowing || haul?.lead_waiting
              ? "OBSTACLE"
              : haul?.phase
            : "OFFLINE"
        }
      >
        <span className="route-turn-symbol" aria-hidden="true">
          {haul?.phase === "ARRIVED"
            ? "✓"
            : haul?.phase === "WAITING"
              ? "!"
              : "↱"}
        </span>
        <div>
          <span>
            {connected
              ? haul?.destination === "Dump point"
                ? "Crusher / unloading"
                : (haul?.destination ?? "Assigned route")
              : "Navigation unavailable"}
          </span>
          <h3>
            {connected
              ? (haul?.next_instruction ?? "Follow the reference route")
              : "Waiting for current telemetry"}
          </h3>
        </div>
        <span className="route-map-source">{world.mode} · Site map</span>
      </header>
      <div className="navigation-map-canvas" ref={container}>
        <svg
          style={{ aspectRatio: aspect }}
          viewBox={`${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`}
          role="img"
          aria-label="Mine route map with vehicle positions and pathway to the dump"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if (follow)
              setPan({ x: center.x - bounds.x, y: center.y - bounds.y });
            setFollow(false);
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={pointerMove}
          onPointerUp={(e) => {
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <pattern
              id="mine-terrain"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M0 8Q4 0 8 8M-4 4Q0-4 4 4M4 4Q8-4 12 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.1"
              />
            </pattern>
          </defs>
          <rect
            x={center.x - width / 2}
            y={center.y - height / 2}
            width={width}
            height={height}
            fill="url(#mine-terrain)"
            className="mine-terrain"
          />
          {haul && (
            <MineCartography features={features} project={planProjection} />
          )}
          {!haul &&
            features
              .filter((f) => f.geometry_type === "POLYGON")
              .map((f) => (
                <polygon
                  key={f.feature_id}
                  points={f.points.map((p) => `${p.x_m},${-p.y_m}`).join(" ")}
                  className={
                    f.feature_type === "HAZARD_ZONE" ? "nav-hazard" : "nav-road"
                  }
                  strokeWidth="0.4"
                />
              ))}
          <polyline
            points={path}
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.65"
            strokeLinejoin="round"
          />
          {connected && haul?.obstacle_detected && (
            <polyline
              points={haul.planned_path
                ?.map((p) => `${p.x_m},${-p.y_m}`)
                .join(" ")}
              fill="none"
              stroke="#74e5fb"
              strokeWidth="0.65"
              strokeLinejoin="round"
              aria-label="Planned path around rock"
            />
          )}
          <polyline
            points={path}
            fill="none"
            stroke="#2684ff"
            strokeWidth="1.05"
            strokeLinejoin="round"
          />
          {!haul &&
            features
              .filter(
                (f) =>
                  f.feature_type === "START" ||
                  f.feature_type === "DESTINATION",
              )
              .map((f) => {
                const p = f.points[0];
                return (
                  <g
                    key={f.feature_id}
                    transform={`translate(${p.x_m} ${-p.y_m})`}
                  >
                    <circle r="2.8" className="nav-site" />
                    <circle
                      r="0.9"
                      fill={f.feature_type === "START" ? "#d97706" : "#23835e"}
                    />
                    <text
                      y="5.5"
                      textAnchor="middle"
                      fontSize={Math.max(1.8, markerScale * 1.6)}
                      fontWeight="700"
                      className="nav-label"
                    >
                      {f.label}
                    </text>
                  </g>
                );
              })}
          {connected && haul?.obstacle && haul.obstacle_detected && (
            <g
              transform={`translate(${haul.obstacle.x_m} ${-haul.obstacle.y_m})`}
              aria-label="Obstruction on haul road"
            >
              <circle r="2" fill="#ef4444" stroke="white" strokeWidth="0.3" />
              <text
                y="0.8"
                textAnchor="middle"
                fill="white"
                fontSize="2.5"
                fontWeight="800"
              >
                !
              </text>
            </g>
          )}
          {connected &&
            world.vehicles.map((v) => (
              <g
                key={v.vehicle_id}
                aria-label={`${v.vehicle_id} position`}
                transform={`translate(${v.x_m} ${-v.y_m})`}
              >
                <g transform={`rotate(${v.heading_deg}) scale(${markerScale})`}>
                  <circle
                    r="3.5"
                    fill={
                      v.vehicle_id === vehicle.vehicle_id
                        ? "#2684ff22"
                        : "#f59e0b22"
                    }
                  />
                  <path
                    d="M0-2.7L2 2L0 1.15L-2 2Z"
                    fill={
                      v.vehicle_id === vehicle.vehicle_id
                        ? "#1875ed"
                        : "#d97706"
                    }
                    stroke="white"
                    strokeWidth="0.45"
                  />
                </g>
                <text
                  y={-4 * markerScale}
                  textAnchor="middle"
                  fontSize={1.8 * markerScale}
                  className="nav-label"
                >
                  {v.vehicle_id}
                </text>
              </g>
            ))}
        </svg>
        <div className="navigation-map-controls" aria-label="Map controls">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(6, z * 1.4))}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.7, z / 1.4))}
          >
            −
          </button>
          <button
            type="button"
            aria-pressed={follow}
            onClick={() => {
              setFollow(!follow);
              if (!follow) setZoom(3);
            }}
          >
            Follow truck
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setFollow(false);
              setPan({ x: 0, y: 0 });
            }}
          >
            Full route
          </button>
        </div>
      </div>
      <footer className="route-trip-summary">
        <div>
          <strong>
            {connected && haul ? `${Math.round(haul.remaining_m)} m` : "—"}
          </strong>
          <span>to destination</span>
        </div>
        <div>
          <strong>
            {connected ? `${(vehicle.speed_mps * 3.6).toFixed(1)} km/h` : "—"}
          </strong>
          <span>current speed</span>
        </div>
        <div>
          <strong>
            {connected && haul
              ? `${Math.round((100 * haul.distance_m) / Math.max(1, haul.total_distance_m))}%`
              : "—"}
          </strong>
          <span>route completed</span>
        </div>
        <div>
          <strong>
            {connected
              ? haul?.phase === "ARRIVED"
                ? "Arrived"
                : haul?.phase === "WAITING"
                  ? "Stopped"
                  : world.simulation.running
                    ? "En route"
                    : "Paused"
              : "Offline"}
          </strong>
          <span>
            {haul?.origin ?? "Route origin"} →{" "}
            {haul?.destination ?? "Destination"}
          </span>
        </div>
      </footer>
    </section>
  );
}
