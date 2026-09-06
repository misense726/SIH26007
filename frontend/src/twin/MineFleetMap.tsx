import { useMemo, useRef, useState } from "react";
import { MineCartography } from "../maps/MineCartography";
import type { HaulRouteState, MapFeature, Point2D } from "../types";
import type { SupervisorVehicle } from "../supervisor/supervisorViewModel";
import "./mineMap.css";

export function MineFleetMap({
  features,
  vehicles,
  haul,
  selectedTruckId,
  onSelectTruck,
}: {
  features: MapFeature[];
  vehicles: SupervisorVehicle[];
  haul?: HaulRouteState | null;
  selectedTruckId?: string | null;
  onSelectTruck?: (id: string | null) => void;
}) {
  const [tilted, setTilted] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const project = useMemo(
    () =>
      (p: Point2D): [number, number] => [
        480 + (p.x_m - 5) * 8 + (tilted ? (p.y_m - 26) * 2.4 : 0),
        275 -
          (p.y_m - 26) * (tilted ? 5.8 : 8) +
          (tilted ? (p.x_m - 5) * 1.1 : 0),
      ],
    [tilted],
  );
  return (
    <div className="mine-fleet-map">
      <div className="mine-map-tools">
        <span>Mine operations</span>
        <div>
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z * 1.25))}
            aria-label="Zoom into mine"
          >
            +
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.7, z / 1.25))}
            aria-label="Zoom out of mine"
          >
            −
          </button>
          <button onClick={() => setTilted((v) => !v)} aria-pressed={tilted}>
            {tilted ? "3D site" : "2D plan"}
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Fit site
          </button>
        </div>
      </div>
      <svg
        viewBox={`${480 + pan.x - 480 / zoom} ${280 + pan.y - 280 / zoom} ${960 / zoom} ${560 / zoom}`}
        role="img"
        aria-label={`${tilted ? "Angled mine map" : "Mine plan"} with pit benches, crusher and fleet traffic`}
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            (e.target instanceof Element && e.target.closest('[role="button"]'))
          )
            return;
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || drag.current.id !== e.pointerId) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = Math.max(960 / rect.width, 560 / rect.height) / zoom;
          const dx = (e.clientX - drag.current.x) * scale,
            dy = (e.clientY - drag.current.y) * scale;
          setPan((p) => ({ x: p.x - dx, y: p.y - dy }));
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
        <MineCartography
          features={features}
          project={project}
          unit={8}
          raised={tilted}
          showRoute={false}
        />
        {haul?.obstacle && (
          <g
            transform={`translate(${project(haul.obstacle).join(" ")})`}
            aria-label="Rock on haul road"
          >
            <path
              d="M-4 2L-3-4L2-6L5 0L2 4Z"
              fill={haul.obstacle_detected ? "#ffad48" : "#696a61"}
              stroke="#e3c29c"
            />
          </g>
        )}
        {vehicles.map((v) => {
          const [x, y] = project({ x_m: v.xM, y_m: v.yM });
          const selected = v.vehicleId === selectedTruckId;
          return (
            <g
              key={v.vehicleId}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${v.vehicleId}. View details`}
              onClick={() => onSelectTruck?.(v.vehicleId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectTruck?.(v.vehicleId);
                }
              }}
            >
              {selected && <circle r="17" fill="#48b5ff25" stroke="#77cdff" />}
              <g transform={`rotate(${v.headingDeg})`}>
                <rect
                  x="-7"
                  y="-11"
                  width="14"
                  height="23"
                  rx="2"
                  fill={v.isPrimary ? "#ffc746" : "#e7ac38"}
                  stroke="#524527"
                />
                <rect x="-5" y="-9" width="10" height="6" fill="#38565c" />
                <rect x="-5" y="0" width="10" height="9" fill="#9b7840" />
              </g>
              <text
                y="-23"
                textAnchor="middle"
                fill="white"
                stroke="#243d2e"
                strokeWidth="3"
                paintOrder="stroke"
                fontSize="12"
              >
                {v.vehicleId}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mine-map-key">
        <span>{haul?.next_instruction ?? "Haul circuit"}</span>
        <span>Trip {haul?.cycle ?? 1}</span>
        <span>Conceptual site, local metres</span>
      </div>
    </div>
  );
}
