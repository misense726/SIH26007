import { useId, useMemo, useState } from "react";
import type { SupervisorVehicle } from "./supervisorViewModel";
import type { WorldState } from "../types";

export type TruckModelId = "cat777" | "beml100" | "hd785";

export interface DataPoint {
  loadPct: number;
  payloadT: number;
  fuelL: number;
  fuelPerTonneL: number;
  effTkmL: number;
}

export interface TruckModel {
  id: TruckModelId;
  name: string;
  fullName: string;
  classification: string;
  ratedT: number;
  engineKw: number;
  engineHp: number;
  color: string;
  colorMuted: string;
  glowColor: string;
  points: DataPoint[];
  sweetSpot: DataPoint;
  origin: string;
  deploymentRole: string;
}

export interface TripRecord {
  tripNum: number;
  payloadT: number;
  fuelL: number;
  effTkmL: number;
  loadPct: number;
  durationMin: number;
  avgSpeedKmh: number;
  timestamp: string;
}

const HAUL_KM = 4.8;
const LOAD_PCTS = [50, 60, 70, 80, 85, 90, 95, 100, 105, 110];
const PAST_TRIP_COUNT = 8;

function buildModel(
  id: TruckModelId,
  name: string,
  fullName: string,
  classification: string,
  ratedT: number,
  engineKw: number,
  engineHp: number,
  color: string,
  colorMuted: string,
  glowColor: string,
  origin: string,
  deploymentRole: string,
  fuelCurve: number[],
): TruckModel {
  const points: DataPoint[] = LOAD_PCTS.map((pct, i) => {
    const payloadT = Math.round(((ratedT * pct) / 100) * 10) / 10;
    const fuelL = fuelCurve[i];
    return {
      loadPct: pct,
      payloadT,
      fuelL,
      fuelPerTonneL: fuelL / payloadT,
      effTkmL: (payloadT * HAUL_KM) / fuelL,
    };
  });
  const sweetSpot = points.reduce((best, pt) => (pt.effTkmL > best.effTkmL ? pt : best));
  return {
    id,
    name,
    fullName,
    classification,
    ratedT,
    engineKw,
    engineHp,
    color,
    colorMuted,
    glowColor,
    origin,
    deploymentRole,
    points,
    sweetSpot,
  };
}

export const TRUCK_MODELS: TruckModel[] = [
  buildModel(
    "cat777",
    "Caterpillar 777D/777E",
    "Caterpillar 777D / 777E Off-Highway Truck",
    "100-ton class mechanical drive hauler",
    91,
    746,
    1004,
    "#e5983b",
    "rgba(229, 152, 59, 0.18)",
    "rgba(229, 152, 59, 0.45)",
    "Peoria, USA · Heavy-duty pit fleet",
    "Staple at Bailadila mining pits for hauling heavy iron ore over steep inclines",
    [28.8, 31.2, 33.6, 36.5, 38.2, 40.0, 42.1, 44.5, 48.2, 53.0],
  ),
  buildModel(
    "beml100",
    "BEML BH100",
    "BEML BH100 Heavy Rear Dumper",
    "100-tonne indigenous heavy hauler",
    100,
    933,
    1250,
    "#3b82f6",
    "rgba(59, 130, 246, 0.18)",
    "rgba(59, 130, 246, 0.45)",
    "BEML India · Indigenous mining plant",
    "Manufactured indigenously by BEML India, heavily utilized across NMDC sites",
    [32.5, 35.2, 38.0, 41.3, 43.2, 45.2, 47.5, 50.0, 54.0, 59.5],
  ),
  buildModel(
    "hd785",
    "Komatsu HD785",
    "Komatsu HD785-7 Deep Pit Dumper",
    "100-ton class mechanical hauler",
    91,
    857,
    1150,
    "#10b981",
    "rgba(16, 185, 129, 0.18)",
    "rgba(16, 185, 129, 0.45)",
    "Komatsu Japan · Continuous duty",
    "Widely used 100-ton heavy dumper known for durability in deep pit mining operations",
    [26.0, 28.2, 30.5, 33.0, 34.5, 36.2, 38.0, 40.0, 43.5, 48.0],
  ),
];

export const TRUCK_MAP = new Map(TRUCK_MODELS.map((t) => [t.id, t]));

export function defaultModelForVehicle(vehicleId: string): TruckModelId {
  if (/HAULER/i.test(vehicleId)) return "hd785";
  const num = parseInt(vehicleId.replace(/\D/g, "")) || 0;
  return num % 2 === 0 ? "beml100" : "cat777";
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function lerpFuel(model: TruckModel, loadPct: number): number {
  const pts = model.points;
  if (loadPct <= pts[0].loadPct) return pts[0].fuelL;
  if (loadPct >= pts[pts.length - 1].loadPct) return pts[pts.length - 1].fuelL;
  for (let i = 0; i < pts.length - 1; i++) {
    if (loadPct <= pts[i + 1].loadPct) {
      const t = (loadPct - pts[i].loadPct) / (pts[i + 1].loadPct - pts[i].loadPct);
      return pts[i].fuelL + t * (pts[i + 1].fuelL - pts[i].fuelL);
    }
  }
  return pts[0].fuelL;
}

function generateTripHistory(vehicleId: string, model: TruckModel): TripRecord[] {
  const rng = seeded(hashCode(vehicleId));
  const trips: TripRecord[] = [];
  const baseMinutes = 15.2;
  for (let i = 0; i < PAST_TRIP_COUNT; i++) {
    const loadPct = Math.round(82 + rng() * 24);
    const payloadT = Math.round(((model.ratedT * loadPct) / 100) * 10) / 10;
    const baseFuel = lerpFuel(model, loadPct);
    const fuelNoise = 0.94 + rng() * 0.12;
    const fuelL = Math.round(baseFuel * fuelNoise * 10) / 10;
    const durationMin = Math.round((baseMinutes + (rng() - 0.5) * 3) * 10) / 10;
    const avgSpeedKmh = Math.round(((HAUL_KM / (durationMin / 60)) * 10)) / 10;
    const effTkmL = Math.round(((payloadT * HAUL_KM) / fuelL) * 100) / 100;
    trips.push({
      tripNum: i + 1,
      payloadT,
      fuelL,
      effTkmL,
      loadPct,
      durationMin,
      avgSpeedKmh,
      timestamp: `Cycle -${PAST_TRIP_COUNT - i}`,
    });
  }
  return trips;
}

function fmt(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function cubicSpline(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

const CHART_LEFT = 48;
const CHART_RIGHT = 384;
const CHART_TOP = 28;
const CHART_BOTTOM = 224;

interface LiveTripChartProps {
  trips: TripRecord[];
  currentTrip: { payloadT: number; fuelL: number; effTkmL: number; speedKmh: number };
  sweetSpotEff: number;
  color: string;
  vehicleId: string;
}

function LiveTripChart({
  trips,
  currentTrip,
  sweetSpotEff,
  color,
  vehicleId,
}: LiveTripChartProps) {
  const chartId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const allPoints = [
    ...trips.map((t) => ({ label: `Run ${t.tripNum}`, eff: t.effTkmL, payload: t.payloadT, fuel: t.fuelL })),
    { label: "LIVE", eff: currentTrip.effTkmL, payload: currentTrip.payloadT, fuel: currentTrip.fuelL },
  ];

  const allEffs = allPoints.map((p) => p.eff);
  const minEff = Math.min(...allEffs, sweetSpotEff) * 0.92;
  const maxEff = Math.max(...allEffs, sweetSpotEff) * 1.06;

  const py = (v: number) =>
    CHART_BOTTOM - ((v - minEff) / (maxEff - minEff)) * (CHART_BOTTOM - CHART_TOP);

  const stepX = (CHART_RIGHT - CHART_LEFT) / (allPoints.length - 1);
  const px = (i: number) => CHART_LEFT + i * stepX;

  const splinePoints = allPoints.map((p, i) => ({ x: px(i), y: py(p.eff) }));
  const linePath = cubicSpline(splinePoints);
  const areaPath = `${linePath} L ${splinePoints[splinePoints.length - 1].x.toFixed(1)} ${CHART_BOTTOM} L ${splinePoints[0].x.toFixed(1)} ${CHART_BOTTOM} Z`;
  const sweetSpotY = py(sweetSpotEff);

  const activePoint = hoveredIndex !== null ? allPoints[hoveredIndex] : null;
  const activeCoord = hoveredIndex !== null ? splinePoints[hoveredIndex] : null;

  return (
    <div className="eff-chart-wrapper">
      <svg
        className="eff-svg-canvas"
        viewBox="0 0 410 268"
        role="img"
        aria-label={`Real-time haul efficiency and history for ${vehicleId}`}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id={`grad-fill-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="60%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
          <filter id={`glow-${chartId}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map((step) => {
          const val = minEff + ((maxEff - minEff) * step) / 4;
          const y = py(val);
          return (
            <g key={`grid-y-${step}`}>
              <line className="eff-grid-line" x1={CHART_LEFT} x2={CHART_RIGHT} y1={y} y2={y} />
              <text className="eff-axis-tick" x={CHART_LEFT - 8} y={y + 3.5} textAnchor="end">
                {fmt(val, 1)}
              </text>
            </g>
          );
        })}

        {/* Sweet spot benchmark guideline */}
        <line
          className="eff-benchmark-line"
          x1={CHART_LEFT}
          x2={CHART_RIGHT}
          y1={sweetSpotY}
          y2={sweetSpotY}
          stroke="#10b981"
          strokeDasharray="4 3"
          strokeWidth="1.2"
          opacity="0.65"
        />
        <text
          className="eff-benchmark-tag"
          x={CHART_RIGHT - 4}
          y={sweetSpotY - 6}
          textAnchor="end"
          fill="#10b981"
        >
          Sweet spot target {fmt(sweetSpotEff, 2)} t·km/L
        </text>

        {/* Area fill under curve */}
        <path d={areaPath} fill={`url(#grad-fill-${chartId})`} />

        {/* Primary curve path */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#glow-${chartId})`}
        />

        {/* Data points */}
        {allPoints.map((pt, i) => {
          const coord = splinePoints[i];
          const isLive = i === allPoints.length - 1;
          const isHovered = hoveredIndex === i;
          return (
            <g
              key={`pt-${i}`}
              className="eff-point-group"
              onMouseEnter={() => setHoveredIndex(i)}
              style={{ cursor: "pointer" }}
            >
              {/* Invisible large hit area */}
              <circle cx={coord.x} cy={coord.y} r="14" fill="transparent" />

              {/* Point marker */}
              {isLive ? (
                <>
                  <circle
                    cx={coord.x}
                    cy={coord.y}
                    r="8"
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    opacity="0.4"
                    className="eff-pulse-ring"
                  />
                  <circle
                    cx={coord.x}
                    cy={coord.y}
                    r="5"
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth="2"
                    filter={`url(#glow-${chartId})`}
                  />
                </>
              ) : (
                <circle
                  cx={coord.x}
                  cy={coord.y}
                  r={isHovered ? 5.5 : 3.8}
                  fill={isHovered ? color : "var(--supervisor-surface, #131920)"}
                  stroke={color}
                  strokeWidth={isHovered ? 2.5 : 1.8}
                  style={{ transition: "all 0.15s ease" }}
                />
              )}

              {/* X axis tick */}
              <text
                className={`eff-axis-tick ${isLive ? "eff-live-x-tick" : ""}`}
                x={coord.x}
                y={CHART_BOTTOM + 16}
                textAnchor="middle"
                fill={isLive ? color : undefined}
                fontWeight={isLive ? 700 : undefined}
              >
                {isLive ? "NOW" : `R${i + 1}`}
              </text>
            </g>
          );
        })}

        {/* Interactive tooltip card */}
        {activePoint && activeCoord && (
          <g transform={`translate(${Math.min(CHART_RIGHT - 110, Math.max(CHART_LEFT, activeCoord.x - 55))}, ${Math.max(12, activeCoord.y - 48)})`}>
            <rect
              x="0"
              y="0"
              width="110"
              height="38"
              rx="6"
              fill="rgba(8, 12, 18, 0.94)"
              stroke={color}
              strokeWidth="1.2"
              filter="drop-shadow(0 4px 12px rgba(0,0,0,0.5))"
            />
            <text x="8" y="15" fill="#f1f5f9" fontSize="9.5" fontWeight="700" fontFamily="var(--mono)">
              {activePoint.label}: {fmt(activePoint.eff, 2)} t·km/L
            </text>
            <text x="8" y="29" fill="var(--supervisor-muted, #94a3b8)" fontSize="8.5" fontFamily="var(--mono)">
              {fmt(activePoint.payload, 0)}t ore · {fmt(activePoint.fuel, 1)}L diesel
            </text>
          </g>
        )}

        {/* Axis titles */}
        <text className="eff-axis-title" x={(CHART_LEFT + CHART_RIGHT) / 2} y={CHART_BOTTOM + 36} textAnchor="middle">
          Haul Cycle (Deposit-14 Pit → Kirandul Plant)
        </text>
        <text
          className="eff-axis-title"
          x={12}
          y={(CHART_TOP + CHART_BOTTOM) / 2}
          textAnchor="middle"
          transform={`rotate(-90, 12, ${(CHART_TOP + CHART_BOTTOM) / 2})`}
        >
          Transport Efficiency (t·km/L)
        </text>
      </svg>
    </div>
  );
}

interface FrontierChartProps {
  model: TruckModel;
  currentTrip: { payloadT: number; effTkmL: number };
  vehicleId: string;
}

function FrontierChart({ model, currentTrip, vehicleId }: FrontierChartProps) {
  const chartId = useId();
  const [hoveredPoint, setHoveredPoint] = useState<DataPoint | null>(null);

  const points = model.points;
  const sweetSpot = model.sweetSpot;

  const minPayload = points[0].payloadT * 0.9;
  const maxPayload = points[points.length - 1].payloadT * 1.05;
  const allEffs = points.map((p) => p.effTkmL);
  const minEff = Math.min(...allEffs) * 0.88;
  const maxEff = Math.max(...allEffs) * 1.08;

  const px = (p: number) =>
    CHART_LEFT + ((p - minPayload) / (maxPayload - minPayload)) * (CHART_RIGHT - CHART_LEFT);
  const py = (e: number) =>
    CHART_BOTTOM - ((e - minEff) / (maxEff - minEff)) * (CHART_BOTTOM - CHART_TOP);

  const curvePoints = points.map((p) => ({ x: px(p.payloadT), y: py(p.effTkmL) }));
  const curvePath = cubicSpline(curvePoints);
  const areaPath = `${curvePath} L ${curvePoints[curvePoints.length - 1].x.toFixed(1)} ${CHART_BOTTOM} L ${curvePoints[0].x.toFixed(1)} ${CHART_BOTTOM} Z`;

  const ssX = px(sweetSpot.payloadT);
  const ssY = py(sweetSpot.effTkmL);

  const curX = px(currentTrip.payloadT);
  const curY = py(currentTrip.effTkmL);

  const underloadBoundaryX = px(model.ratedT * 0.8);
  const overloadBoundaryX = px(model.ratedT * 1.0);

  return (
    <div className="eff-chart-wrapper">
      <svg
        className="eff-svg-canvas"
        viewBox="0 0 410 268"
        role="img"
        aria-label={`Model efficiency frontier curve for ${model.name}`}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        <defs>
          <linearGradient id={`frontier-fill-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={model.color} stopOpacity="0.25" />
            <stop offset="60%" stopColor={model.color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={model.color} stopOpacity="0.01" />
          </linearGradient>
          <filter id={`frontier-glow-${chartId}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Operating zone backdrops */}
        {/* Sweet spot window backdrop */}
        <rect
          x={underloadBoundaryX}
          y={CHART_TOP}
          width={overloadBoundaryX - underloadBoundaryX}
          height={CHART_BOTTOM - CHART_TOP}
          fill="color-mix(in srgb, var(--status-good, #10b981) 6%, transparent)"
          stroke="none"
        />

        {/* Overload penalty backdrop */}
        <rect
          x={overloadBoundaryX}
          y={CHART_TOP}
          width={CHART_RIGHT - overloadBoundaryX}
          height={CHART_BOTTOM - CHART_TOP}
          fill="color-mix(in srgb, #ef4444 4%, transparent)"
          stroke="none"
        />

        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map((step) => {
          const val = minEff + ((maxEff - minEff) * step) / 4;
          const y = py(val);
          return (
            <g key={`fgrid-y-${step}`}>
              <line className="eff-grid-line" x1={CHART_LEFT} x2={CHART_RIGHT} y1={y} y2={y} />
              <text className="eff-axis-tick" x={CHART_LEFT - 8} y={y + 3.5} textAnchor="end">
                {fmt(val, 1)}
              </text>
            </g>
          );
        })}

        {/* X axis payload ticks */}
        {[0, 1, 2, 3, 4].map((step) => {
          const val = minPayload + ((maxPayload - minPayload) * step) / 4;
          const x = px(val);
          return (
            <text key={`fgrid-x-${step}`} className="eff-axis-tick" x={x} y={CHART_BOTTOM + 16} textAnchor="middle">
              {Math.round(val)}t
            </text>
          );
        })}

        {/* Zone dividing lines */}
        <line
          x1={underloadBoundaryX}
          x2={underloadBoundaryX}
          y1={CHART_TOP}
          y2={CHART_BOTTOM}
          stroke="var(--supervisor-line, #334155)"
          strokeDasharray="2 3"
          strokeWidth="1"
          opacity="0.5"
        />
        <line
          x1={overloadBoundaryX}
          x2={overloadBoundaryX}
          y1={CHART_TOP}
          y2={CHART_BOTTOM}
          stroke="#ef4444"
          strokeDasharray="2 3"
          strokeWidth="1"
          opacity="0.4"
        />

        {/* Area fill */}
        <path d={areaPath} fill={`url(#frontier-fill-${chartId})`} />

        {/* Primary curve */}
        <path
          d={curvePath}
          fill="none"
          stroke={model.color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#frontier-glow-${chartId})`}
        />

        {/* Sweet spot vertical drop guide */}
        <line
          x1={ssX}
          x2={ssX}
          y1={ssY}
          y2={CHART_BOTTOM}
          stroke={model.color}
          strokeDasharray="3 3"
          strokeWidth="1.4"
          opacity="0.6"
        />

        {/* Curve points */}
        {points.map((pt) => {
          const x = px(pt.payloadT);
          const y = py(pt.effTkmL);
          const isSweetSpot = pt === sweetSpot;
          return (
            <g
              key={`fpt-${pt.loadPct}`}
              onMouseEnter={() => setHoveredPoint(pt)}
              style={{ cursor: "pointer" }}
            >
              <circle cx={x} cy={y} r="12" fill="transparent" />
              {!isSweetSpot && (
                <circle
                  cx={x}
                  cy={y}
                  r={hoveredPoint === pt ? 5 : 3.2}
                  fill={hoveredPoint === pt ? model.color : "var(--supervisor-surface, #131920)"}
                  stroke={model.color}
                  strokeWidth="1.8"
                />
              )}
            </g>
          );
        })}

        {/* Sweet Spot Peak Beacon */}
        <g transform={`translate(${ssX}, ${ssY})`}>
          <circle
            r="9"
            fill="none"
            stroke={model.color}
            strokeWidth="1.5"
            opacity="0.5"
            className="eff-pulse-ring"
          />
          <circle
            r="6"
            fill={model.color}
            stroke="#ffffff"
            strokeWidth="2"
            filter={`url(#frontier-glow-${chartId})`}
          />
          {/* Sweet Spot Callout Flag */}
          <g transform="translate(0, -18)">
            <rect
              x="-60"
              y="-18"
              width="120"
              height="20"
              rx="5"
              fill="rgba(8, 14, 24, 0.95)"
              stroke={model.color}
              strokeWidth="1.2"
              filter="drop-shadow(0 2px 8px rgba(0,0,0,0.5))"
            />
            <text
              x="0"
              y="-5"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="9"
              fontWeight="800"
              fontFamily="var(--mono)"
              letterSpacing="0.03em"
            >
              ★ SWEET SPOT: {sweetSpot.payloadT}t
            </text>
          </g>
        </g>

        {/* Current Vehicle Operating Position Crosshair */}
        <g transform={`translate(${curX}, ${curY})`}>
          <circle
            r="11"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.5"
            strokeDasharray="3 2"
            className="eff-rotate-ring"
          />
          <circle r="4.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.8" />
          <g transform="translate(14, 16)">
            <rect
              x="-4"
              y="-12"
              width="98"
              height="18"
              rx="4"
              fill="rgba(3, 7, 18, 0.92)"
              stroke="#38bdf8"
              strokeWidth="1"
            />
            <text x="4" y="0" fill="#38bdf8" fontSize="8.5" fontWeight="700" fontFamily="var(--mono)">
              {vehicleId} NOW
            </text>
          </g>
        </g>

        {/* Hovered point tooltip */}
        {hoveredPoint && (
          <g transform={`translate(${Math.min(CHART_RIGHT - 120, Math.max(CHART_LEFT, px(hoveredPoint.payloadT) - 60))}, ${Math.max(10, py(hoveredPoint.effTkmL) - 52)})`}>
            <rect
              x="0"
              y="0"
              width="120"
              height="44"
              rx="6"
              fill="rgba(8, 12, 18, 0.94)"
              stroke={model.color}
              strokeWidth="1.2"
              filter="drop-shadow(0 4px 12px rgba(0,0,0,0.6))"
            />
            <text x="8" y="15" fill="#f1f5f9" fontSize="9.5" fontWeight="700" fontFamily="var(--mono)">
              {hoveredPoint.loadPct}% Load · {fmt(hoveredPoint.payloadT, 0)}t
            </text>
            <text x="8" y="27" fill={model.color} fontSize="9" fontWeight="650" fontFamily="var(--mono)">
              {fmt(hoveredPoint.effTkmL, 2)} t·km/L efficiency
            </text>
            <text x="8" y="38" fill="var(--supervisor-muted, #94a3b8)" fontSize="8" fontFamily="var(--mono)">
              {fmt(hoveredPoint.fuelL, 1)}L diesel · {fmt(hoveredPoint.fuelPerTonneL, 3)} L/t
            </text>
          </g>
        )}

        {/* Axis titles */}
        <text className="eff-axis-title" x={(CHART_LEFT + CHART_RIGHT) / 2} y={CHART_BOTTOM + 36} textAnchor="middle">
          Payload per Trip (tonnes)
        </text>
        <text
          className="eff-axis-title"
          x={12}
          y={(CHART_TOP + CHART_BOTTOM) / 2}
          textAnchor="middle"
          transform={`rotate(-90, 12, ${(CHART_TOP + CHART_BOTTOM) / 2})`}
        >
          Efficiency (t·km/L)
        </text>
      </svg>
    </div>
  );
}

export interface HaulEfficiencyPanelProps {
  vehicles?: SupervisorVehicle[];
  world?: WorldState;
}

const DEFAULT_FLEET: SupervisorVehicle[] = [
  {
    vehicleId: "DUMPER_01",
    isPrimary: true,
    isSimulated: true,
    sourceLabel: "Primary telemetry",
    hasPosition: true,
    xM: 0,
    yM: 0,
    headingDeg: 0,
    speedMps: 6.5,
    positionConfidence: 1,
    emergencyState: "SAFE",
    linkStatus: "EXCELLENT",
    distanceM: 0,
    lastUpdateMs: 1_700_000_000_000,
    ageMs: 0,
    tone: "nominal",
  },
  {
    vehicleId: "DUMPER_02",
    isPrimary: false,
    isSimulated: true,
    sourceLabel: "Vehicle + V2X",
    hasPosition: true,
    xM: 20,
    yM: 40,
    headingDeg: 45,
    speedMps: 5.8,
    positionConfidence: 0.9,
    emergencyState: "SAFE",
    linkStatus: "GOOD",
    distanceM: 45,
    lastUpdateMs: 1_700_000_000_000,
    ageMs: 100,
    tone: "nominal",
  },
  {
    vehicleId: "HAULER_09",
    isPrimary: false,
    isSimulated: true,
    sourceLabel: "V2X simulation",
    hasPosition: true,
    xM: -30,
    yM: 80,
    headingDeg: 180,
    speedMps: 0,
    positionConfidence: 0.8,
    emergencyState: "WARNING",
    linkStatus: "DEGRADED",
    distanceM: 85,
    lastUpdateMs: 1_700_000_000_000,
    ageMs: 200,
    tone: "attention",
  },
];

export function HaulEfficiencyPanel({ vehicles, world }: HaulEfficiencyPanelProps) {
  const fleet = vehicles !== undefined ? vehicles : DEFAULT_FLEET;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [manualModelOverride, setManualModelOverride] = useState<TruckModelId | null>(null);

  const effectiveVehicleId =
    selectedVehicleId && fleet.some((v) => v.vehicleId === selectedVehicleId)
      ? selectedVehicleId
      : fleet[0]?.vehicleId ?? "DUMPER_01";

  const selectedVehicle =
    fleet.find((v) => v.vehicleId === effectiveVehicleId) ?? fleet[0] ?? null;

  const defaultModelId = defaultModelForVehicle(effectiveVehicleId);
  const activeModelId = manualModelOverride ?? defaultModelId;
  const activeModel = TRUCK_MAP.get(activeModelId) ?? TRUCK_MODELS[0];

  const trips = useMemo(
    () => (effectiveVehicleId ? generateTripHistory(effectiveVehicleId, activeModel) : []),
    [effectiveVehicleId, activeModel],
  );

  // Live telemetry estimation
  const liveSpeedMps = selectedVehicle?.speedMps ?? 6.2;
  const liveSpeedKmh = Math.round(liveSpeedMps * 3.6 * 10) / 10;
  const liveCycle = world?.haul_route?.cycle ?? 9;
  const liveDistanceM = world?.haul_route?.distance_m ?? 2450;
  const liveProgressPct = Math.min(100, Math.round((liveDistanceM / (HAUL_KM * 1000)) * 100));

  // Current trip live operating estimate (typically ~85-98% load)
  const currentLoadPct = 95;
  const currentPayloadT = Math.round(((activeModel.ratedT * currentLoadPct) / 100) * 10) / 10;
  const currentFuelL = Math.round(lerpFuel(activeModel, currentLoadPct) * 10) / 10;
  const currentEffTkmL = Math.round(((currentPayloadT * HAUL_KM) / currentFuelL) * 100) / 100;

  const currentTrip = {
    payloadT: currentPayloadT,
    fuelL: currentFuelL,
    effTkmL: currentEffTkmL,
    speedKmh: liveSpeedKmh,
  };

  const avgHistoricalEff = trips.length
    ? trips.reduce((sum, t) => sum + t.effTkmL, 0) / trips.length
    : currentEffTkmL;

  const sweetSpotEff = activeModel.sweetSpot.effTkmL;
  const efficiencyGapPct = Math.round(((currentEffTkmL - sweetSpotEff) / sweetSpotEff) * 1000) / 10;
  const totalOreMovedTonnes = trips.reduce((sum, t) => sum + t.payloadT, 0) + currentPayloadT;
  const totalFuelBurnedL = trips.reduce((sum, t) => sum + t.fuelL, 0) + currentFuelL;

  if (fleet.length === 0) {
    return (
      <div className="supervisor-section efficiency-workspace">
        <article className="supervisor-panel efficiency-panel">
          <div className="supervisor-empty-state">
            <span aria-hidden="true">◇</span>
            <strong>No fleet vehicles online</strong>
            <p>Vehicle telemetry is required to compute haul efficiency.</p>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="supervisor-section efficiency-workspace">
      <article
        className="supervisor-panel efficiency-panel"
        style={{ "--truck-accent": activeModel.color } as React.CSSProperties}
      >
        {/* Panel Header with Vehicle Selector Dropdown */}
        <header className="supervisor-panel-heading efficiency-heading">
          <div className="efficiency-title-group">
            <p className="eyebrow">Fleet performance · Bailadila Deposit-14</p>
            <h3>Haul efficiency &amp; fuel optimization</h3>
          </div>

          <div className="efficiency-controls-bar">
            {/* Vehicle Selector Dropdown */}
            <label className="vehicle-dropdown-label" htmlFor="efficiency-vehicle-select">
              <span className="dropdown-field-title">Active Vehicle:</span>
              <div className="vehicle-select-container">
                <i
                  className="vehicle-status-dot"
                  style={{ background: activeModel.color }}
                  aria-hidden="true"
                />
                <select
                  id="efficiency-vehicle-select"
                  className="vehicle-select-native"
                  value={effectiveVehicleId}
                  onChange={(e) => {
                    setSelectedVehicleId(e.target.value);
                    setManualModelOverride(null); // reset override to match vehicle
                  }}
                >
                  {fleet.map((v) => {
                    const assigned = TRUCK_MAP.get(defaultModelForVehicle(v.vehicleId))!;
                    return (
                      <option key={v.vehicleId} value={v.vehicleId}>
                        {v.vehicleId} · {assigned.name} ({v.isPrimary ? "PRIMARY" : "PEER"})
                      </option>
                    );
                  })}
                </select>
              </div>
            </label>

            {/* Model Selector Tabs for Comparative Analysis */}
            <div className="model-toggle-group" role="tablist" aria-label="Truck models">
              {TRUCK_MODELS.map((m) => {
                const isActive = activeModel.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`model-toggle-btn ${isActive ? "active" : ""}`}
                    onClick={() => setManualModelOverride(m.id)}
                    style={isActive ? ({ "--btn-accent": m.color } as React.CSSProperties) : undefined}
                  >
                    <span className="model-dot" style={{ background: m.color }} />
                    <span className="model-short-name">{m.name.split("/")[0].replace("Caterpillar", "Cat")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* High-Impact Metric Strip */}
        <div className="efficiency-metric-strip">
          <div className="metric-cell">
            <span>Selected Unit</span>
            <strong className="eff-metric-highlight" style={{ color: activeModel.color }}>
              {effectiveVehicleId}
            </strong>
            <small>{activeModel.name} · {activeModel.engineHp} hp</small>
          </div>

          <div className="metric-cell">
            <span>Live Transport Efficiency</span>
            <strong className="eff-metric-val">
              {fmt(currentEffTkmL, 2)} <span className="eff-unit">t·km/L</span>
            </strong>
            <small className={efficiencyGapPct >= -2 ? "eff-status-opt" : "eff-status-warn"}>
              {efficiencyGapPct >= 0 ? "▲" : "▼"} {Math.abs(efficiencyGapPct)}% vs sweet spot
            </small>
          </div>

          <div className="metric-cell">
            <span>Model Sweet Spot</span>
            <strong className="eff-metric-val">
              {fmt(sweetSpotEff, 2)} <span className="eff-unit">t·km/L</span>
            </strong>
            <small>Optimal at {activeModel.sweetSpot.payloadT}t ({activeModel.sweetSpot.loadPct}% load)</small>
          </div>

          <div className="metric-cell">
            <span>Total Ore Transported</span>
            <strong className="eff-metric-val">
              {Math.round(totalOreMovedTonnes)} <span className="eff-unit">tonnes</span>
            </strong>
            <small>{fmt(totalFuelBurnedL, 0)} L fuel burned · {trips.length + 1} cycles</small>
          </div>
        </div>

        {/* Two Polished Charts Side-by-Side */}
        <div className="efficiency-body">
          {/* Left: Real-Time Haul Telemetry & Cycle History */}
          <div className="efficiency-plot-panel left-plot-panel">
            <div className="efficiency-plot-title">
              <div>
                <strong>Live Haul Performance</strong>
                <span>
                  {effectiveVehicleId} telemetry stream · 4.8 km Deposit-14 haul road
                </span>
              </div>
              <div className="plot-badge live-indicator">
                <i className="ping-dot" />
                <span>LIVE {liveSpeedKmh} km/h</span>
              </div>
            </div>

            <LiveTripChart
              trips={trips}
              currentTrip={currentTrip}
              sweetSpotEff={sweetSpotEff}
              color={activeModel.color}
              vehicleId={effectiveVehicleId}
            />

            <footer className="plot-footer-summary">
              <div>
                <span className="footer-label">Circuit Progress:</span>
                <strong>{liveDistanceM}m / 4,800m ({liveProgressPct}%)</strong>
              </div>
              <div>
                <span className="footer-label">Cycle #:</span>
                <strong>Run {liveCycle} (Deposit-14 Pit)</strong>
              </div>
              <div>
                <span className="footer-label">Average Run:</span>
                <strong>{fmt(avgHistoricalEff, 2)} t·km/L</strong>
              </div>
            </footer>
          </div>

          {/* Right: Model Efficiency Frontier Curve */}
          <div className="efficiency-plot-panel right-plot-panel">
            <div className="efficiency-plot-title">
              <div>
                <strong>Efficiency Frontier Curve</strong>
                <span>
                  Payload vs fuel burn envelope · {activeModel.classification}
                </span>
              </div>
              <div className="plot-badge model-spec-badge" style={{ borderColor: activeModel.color }}>
                <span style={{ color: activeModel.color }}>{activeModel.ratedT}t Class · {activeModel.engineKw} kW</span>
              </div>
            </div>

            <FrontierChart
              model={activeModel}
              currentTrip={currentTrip}
              vehicleId={effectiveVehicleId}
            />

            <footer className="plot-footer-summary">
              <div>
                <span className="footer-label">Sweet Spot:</span>
                <strong style={{ color: activeModel.color }}>
                  {activeModel.sweetSpot.payloadT}t ({activeModel.sweetSpot.loadPct}%)
                </strong>
              </div>
              <div>
                <span className="footer-label">Fuel at Sweet Spot:</span>
                <strong>{fmt(activeModel.sweetSpot.fuelL, 1)} L/cycle</strong>
              </div>
              <div>
                <span className="footer-label">Deployment:</span>
                <span className="footer-desc" title={activeModel.deploymentRole}>
                  NMDC Bailadila iron ore
                </span>
              </div>
            </footer>
          </div>
        </div>
      </article>
    </div>
  );
}
