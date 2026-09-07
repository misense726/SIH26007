import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import type { HaulRouteState, MapFeature, Point2D } from "../types";
import type { SupervisorVehicle } from "../supervisor/supervisorViewModel";
import { placeLabels, planBounds, scaleDistance } from "./planLayout";
import { PlanLegend, PlanSymbol, type PlanSymbolKind } from "./PlanSymbols";
import "./minePlan.css";

const BaseMap = memo(function BaseMap({
  features,
  project,
  routeVisible,
}: {
  features: MapFeature[];
  project: (p: Point2D) => [number, number];
  routeVisible: boolean;
}) {
  const benches = features.filter((f) => f.properties.cartography === "bench");
  const ordered = [...features].sort(
    (a, b) =>
      Number(b.properties.cartography === "contour") -
      Number(a.properties.cartography === "contour"),
  );
  return (
    <g aria-label="Mine roads and pit benches">
      {ordered
        .filter((f) => f.geometry_type !== "POINT")
        .map((f) => {
          const points = f.points
            .map(project)
            .map((p) => p.join(","))
            .join(" ");
          const kind = f.properties.cartography;
          if (f.feature_type === "CENTERLINE" || f.feature_type === "BERM")
            return null;
          if (f.geometry_type === "POLYLINE") {
            if (f.feature_type === "ROUTE") return null;
            return (
              <polyline
                key={f.feature_id}
                points={points}
                className="plan-contour"
              />
            );
          }
          const fill =
            f.feature_type === "ROAD"
              ? "#d3bf98"
              : kind === "pit"
                ? "#b8a58d"
                : kind === "bench"
                  ? ["#b8a58d", "#b09e87", "#a7957e", "#9f8d77", "#97856f"][
                      benches.indexOf(f) % 5
                    ]
                  : "#dac3b0";
          return (
            <polygon
              key={f.feature_id}
              points={points}
              fill={fill}
              className={`plan-area ${kind === "bench" ? "plan-bench" : f.feature_type === "ROAD" ? "plan-road" : "plan-pit"}`}
            />
          );
        })}
      {routeVisible &&
        features
          .filter((f) => f.feature_type === "ROUTE")
          .map((f) => (
            <polyline
              key={f.feature_id}
              points={f.points
                .map(project)
                .map((p) => p.join(","))
                .join(" ")}
              className="plan-route"
            />
          ))}
    </g>
  );
});

export function MinePlanView({
  features,
  vehicles,
  haul,
  selectedTruckId,
  onSelectTruck,
  zoom,
  pan,
  onPan,
  routeVisible,
}: {
  features: MapFeature[];
  vehicles: SupervisorVehicle[];
  haul?: HaulRouteState | null;
  selectedTruckId?: string | null;
  onSelectTruck?: (id: string | null) => void;
  zoom: number;
  pan: { x: number; y: number };
  onPan: (next: { x: number; y: number }) => void;
  routeVisible: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const gridId = useId();
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const bounds = useMemo(() => planBounds(features), [features]);
  const scale =
    Math.max(
      0.1,
      Math.min(
        (size.width - 110) / bounds.width,
        (size.height - 150) / bounds.height,
      ),
    ) * zoom;
  const project = useMemo(
    () =>
      (p: Point2D): [number, number] => [
        size.width / 2 + (p.x_m - bounds.x - pan.x) * scale,
        size.height / 2 - (p.y_m - bounds.y - pan.y) * scale,
      ],
    [size, bounds, pan, scale],
  );
  const sites = features
    .filter((f) => f.geometry_type === "POINT" && f.points.length && f.label)
    .map((f) => {
      const [x, y] = project(f.points[0]);
      return {
        id: f.feature_id,
        x,
        y,
        text:
          f.feature_type === "DESTINATION" ? "Crusher / unloading" : f.label,
        kind: (f.feature_type === "DESTINATION"
          ? "crusher"
          : f.feature_type === "START"
            ? "mine"
            : "yard") as PlanSymbolKind,
      };
    });
  const truckPoints = [...vehicles]
    .sort(
      (a, b) =>
        Number(b.vehicleId === selectedTruckId) -
        Number(a.vehicleId === selectedTruckId),
    )
    .map((v) => {
      const [x, y] = project({ x_m: v.xM, y_m: v.yM });
      return { ...v, id: v.vehicleId, x, y, text: v.vehicleId };
    });
  const inFrame = (p: { x: number; y: number }) =>
    p.x > 12 && p.x < size.width - 12 && p.y > 42 && p.y < size.height - 45;
  const labels = placeLabels(
    [...sites, ...truckPoints].filter(inFrame),
    size.width,
    size.height,
  );
  const distance = scaleDistance(scale),
    length = distance * scale;
  return (
    <div className="mine-plan-layout">
      <div className="mine-plan-canvas" ref={host}>
        <svg
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="img"
          aria-label="Mine plan with pit benches, crusher and fleet traffic"
          onPointerDown={(e) => {
            if (
              e.button !== 0 ||
              (e.target instanceof Element &&
                e.target.closest('[role="button"]'))
            )
              return;
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const previous = drag.current;
            if (!previous || previous.id !== e.pointerId) return;
            onPan({
              x: pan.x - (e.clientX - previous.x) / scale,
              y: pan.y + (e.clientY - previous.y) / scale,
            });
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          }}
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
              id={gridId}
              width={10 * scale}
              height={10 * scale}
              patternUnits="userSpaceOnUse"
              x={project({ x_m: 0, y_m: 0 })[0]}
              y={project({ x_m: 0, y_m: 0 })[1]}
            >
              <path
                d={`M0 4V0H4`}
                fill="none"
                stroke="#bcc8c4"
                strokeWidth="0.8"
              />
            </pattern>
          </defs>
          <rect
            width={size.width}
            height={size.height}
            fill={`url(#${gridId})`}
          />
          <BaseMap
            features={features}
            project={project}
            routeVisible={routeVisible}
          />
          {sites.map((site) => (
            <g key={site.id} transform={`translate(${site.x} ${site.y})`}>
              <PlanSymbol kind={site.kind} />
            </g>
          ))}
          {haul?.obstacle && (
            <g
              transform={`translate(${project(haul.obstacle).join(" ")})`}
              aria-label={
                haul.obstacle_detected
                  ? "Rock detected on haul road"
                  : "Simulated rock on haul road"
              }
            >
              <PlanSymbol kind="rock" />
            </g>
          )}
          {labels.map((label) => (
            <g key={label.id} className="plan-label" aria-hidden="true">
              <path
                d={`M${label.x} ${label.y}L${Math.max(label.left, Math.min(label.left + label.width, label.x))} ${label.top + 13}`}
              />
              <rect
                x={label.left}
                y={label.top}
                width={label.width}
                height={label.height}
                rx="4"
              />
              <text x={label.left + 10} y={label.top + 17}>
                {label.text}
              </text>
            </g>
          ))}
          {truckPoints.map((v) => (
            <g
              key={v.vehicleId}
              transform={`translate(${v.x} ${v.y})`}
              role="button"
              tabIndex={0}
              className="plan-truck"
              aria-label={`${v.vehicleId}. View details`}
              aria-pressed={v.vehicleId === selectedTruckId}
              onClick={() => onSelectTruck?.(v.vehicleId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectTruck?.(v.vehicleId);
                }
              }}
            >
              <circle r="21" fill="transparent" />
              {v.vehicleId === selectedTruckId && (
                <circle
                  r="21"
                  fill="#2477c910"
                  stroke="#2477c9"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                />
              )}
              <g transform={`rotate(${v.headingDeg})`}>
                <PlanSymbol kind={v.isPrimary ? "primary" : "peer"} />
              </g>
              {v.tone !== "nominal" && (
                <g>
                  <circle
                    cx="12"
                    cy="-12"
                    r="7"
                    fill={
                      v.tone === "critical"
                        ? "#b33d30"
                        : v.tone === "attention"
                          ? "#916115"
                          : "#59676d"
                    }
                  />
                  <text
                    x="12"
                    y="-8"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="white"
                  >
                    {v.tone === "lost" || v.tone === "unknown" ? "?" : "!"}
                  </text>
                </g>
              )}
            </g>
          ))}
          <g transform="translate(22 24)" className="plan-direction">
            <path d="M0 12V-9M-4-4L0-9L4-4" />
            <text x="10" y="4">
              Local +Y
            </text>
          </g>
          <g
            transform={`translate(22 ${size.height - 24})`}
            className="plan-scale"
            aria-label={`${distance} metre scale`}
          >
            <path d={`M0-5V0H${length}V-5M${length / 2} 0V-4`} />
            <text y="-11">0</text>
            <text x={length} y="-11" textAnchor="end">
              {distance} m
            </text>
          </g>
          <text
            x={size.width - 18}
            y={size.height - 21}
            textAnchor="end"
            className="plan-drag-hint"
          >
            Drag to pan
          </text>
        </svg>
      </div>
      <PlanLegend routeVisible={routeVisible} />
    </div>
  );
}
