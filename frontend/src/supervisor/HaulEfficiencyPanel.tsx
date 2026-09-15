import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DataMode, WorldState } from "../types";
import type { SupervisorVehicle } from "./supervisorViewModel";
import { STATIC_DEMO } from "../simulation/demoMode";
import {
  DISPLAYED_TRIP_COUNT,
  efficiencyScale,
  formatValue as fmt,
  selectEfficiencyTrips,
  summarizeTrips,
  type EfficiencyTrip,
} from "./haulEfficiency";
import { useHaulageEfficiencyData } from "./useHaulageEfficiencyData";
import "./haulEfficiency.css";

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sourceLabel(source?: DataMode): string {
  return source === "SIMULATED" ? "Simulated" : source === "REPLAY" ? "Replay" : source === "LIVE" ? "Live" : "Source unknown";
}

interface HaulCycleChartProps {
  trips: EfficiencyTrip[];
  vehicleId: string;
  activeId: string | null;
  onInspect: (id: string | null) => void;
  loading?: boolean;
}

export function HaulCycleChart({ trips, vehicleId, activeId, onInspect, loading }: HaulCycleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const patternId = useId();
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const active = trips.find((trip) => trip.id === activeId);
  const left = 48;
  const right = width - 22;
  const top = 38;
  const bottom = 222;
  const payloadTop = 284;
  const payloadBottom = 362;
  const slot = (right - left) / Math.max(trips.length, 1);
  const x = (index: number) => left + slot * (index + 0.5);
  const scale = efficiencyScale(trips.length ? trips.map((trip) => trip.efficiency) : [0]);
  const y = (value: number) => bottom - (value - scale.min) / (scale.max - scale.min) * (bottom - top);
  const payloadMax = Math.max(20, Math.ceil(Math.max(...trips.map((trip) => trip.payloadT), 0) / 20) * 20);
  const payloadY = (value: number) => payloadBottom - value / payloadMax * (payloadBottom - payloadTop);
  const summary = summarizeTrips(trips);
  const path = trips.map((trip, index) => `${index ? "L" : "M"} ${x(index)} ${y(trip.efficiency)}`).join(" ");
  const area = trips.length > 1 ? `${path} L ${x(trips.length - 1)} ${bottom} L ${x(0)} ${bottom} Z` : "";
  const tickEvery = width < 480 ? 3 : trips.length > 20 ? 2 : 1;

  return (
    <div className="haul-chart" ref={containerRef}>
      <div className="haul-chart-readout" role={active ? "tooltip" : undefined}>
        {active ? (
          <><strong>{fmt(active.efficiency, 2)} t·km/L</strong><span>Haul {String(active.number).padStart(2, "0")} · {fmt(active.payloadT)} t payload · {fmt(active.fuelL)} L estimated fuel</span></>
        ) : (
          <span>Hover, tap or focus a haul to inspect its load and fuel use.</span>
        )}
      </div>
      {!trips.length ? (
        <div className="haul-empty" role="status">
          <strong>{loading ? "Loading completed hauls" : "No completed hauls yet"}</strong>
          <p>{loading ? "Fetching this truck's trip history." : "A haul appears after the truck finishes its loaded journey, unloading and empty return."}</p>
          <span>No placeholder values are added to live data.</span>
        </div>
      ) : (
        <>
        <svg
          className="haul-chart-svg"
          viewBox={`0 0 ${width} 400`}
          aria-label={`Efficiency and payload for ${trips.length} completed hauls by ${vehicleId}`}
        >
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="Canvas" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="CanvasText" strokeWidth="2" />
            </pattern>
          </defs>
          <text className="haul-axis-title" x={left} y="16">Transport efficiency · t·km/L</text>
          {scale.ticks.map((value) => (
            <g key={value}>
              <line className="haul-grid" x1={left} x2={right} y1={y(value)} y2={y(value)} />
              <text className="haul-axis-tick" x={left - 10} y={y(value) + 4} textAnchor="end">{fmt(value)}</text>
            </g>
          ))}
          {summary.efficiency !== null && (
            <line className="haul-average-line" x1={left} x2={right} y1={y(summary.efficiency)} y2={y(summary.efficiency)} />
          )}
          <path className="haul-efficiency-area" d={area} />
          <path className="haul-efficiency-line" d={path} />
          <text className="haul-axis-title" x={left} y="268">Payload · tonnes</text>
          {[0, payloadMax / 2, payloadMax].map((value) => (
            <g key={`payload-${value}`}>
              <line className="haul-grid" x1={left} x2={right} y1={payloadY(value)} y2={payloadY(value)} />
              <text className="haul-axis-tick" x={left - 10} y={payloadY(value) + 4} textAnchor="end">{value}</text>
            </g>
          ))}
          {trips.map((trip, index) => {
            const px = x(index);
            const barWidth = Math.min(18, slot * 0.48);
            const barRadius = Math.min(4, Math.max(0, barWidth / 2 - 0.5));
            const isActive = activeId === trip.id;
            return (
              <g key={trip.id} className={`haul-mark ${isActive ? "is-active" : ""}`}>
                {isActive && <line className="haul-crosshair" x1={px} x2={px} y1={top} y2={payloadBottom} />}
                <circle className="haul-efficiency-dot" cx={px} cy={y(trip.efficiency)} r={isActive ? 6 : 4.5} />
                <path
                  className="haul-payload-bar"
                  style={{ "--haul-print-fill": `url(#${patternId})` } as React.CSSProperties}
                  d={`M ${px - barWidth / 2} ${payloadBottom} V ${payloadY(trip.payloadT) + barRadius} Q ${px - barWidth / 2} ${payloadY(trip.payloadT)} ${px - barWidth / 2 + barRadius} ${payloadY(trip.payloadT)} H ${px + barWidth / 2 - barRadius} Q ${px + barWidth / 2} ${payloadY(trip.payloadT)} ${px + barWidth / 2} ${payloadY(trip.payloadT) + barRadius} V ${payloadBottom} Z`}
                />
                {(index % tickEvery === 0 || index === trips.length - 1) && (
                  <text className="haul-axis-tick" x={px} y="382" textAnchor="middle">{String(trip.number).padStart(2, "0")}</text>
                )}
              </g>
            );
          })}
        </svg>
        <div
          className="haul-hit-layer"
          style={{
            left: `${(left / width) * 100}%`,
            right: `${((width - right) / width) * 100}%`,
            top: `${(top / 400) * 100}%`,
            bottom: `${((400 - payloadBottom) / 400) * 100}%`,
            gridTemplateColumns: `repeat(${trips.length}, minmax(0, 1fr))`,
          }}
        >
          {trips.map((trip, index) => (
            <button
              key={trip.id}
              type="button"
              className="haul-hit-target"
              aria-label={`Haul ${trip.number}: ${fmt(trip.efficiency, 2)} t·km/L, ${fmt(trip.payloadT)} tonnes, ${fmt(trip.fuelL)} litres estimated fuel`}
              onPointerEnter={() => onInspect(trip.id)}
              onPointerLeave={() => onInspect(null)}
              onFocus={() => onInspect(trip.id)}
              onBlur={() => onInspect(null)}
              onClick={() => onInspect(trip.id)}
              onKeyDown={(event) => {
                if (event.key === "Escape") { onInspect(null); event.currentTarget.blur(); }
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const next = index + (event.key === "ArrowRight" ? 1 : -1);
                  const targets = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".haul-hit-target");
                  targets?.[Math.max(0, Math.min(trips.length - 1, next))]?.focus();
                }
              }}
            />
          ))}
        </div>
        </>
      )}
      <div className="haul-chart-footer"><span>Oldest haul</span><span>Completed hauls in this window</span><span>Latest haul</span></div>
    </div>
  );
}

function TripDetail({ trip, mode, latest }: { trip: EfficiencyTrip | null; mode?: DataMode; latest: boolean }) {
  return (
    <aside className="haul-detail" aria-label="Haul details">
      <div className="haul-detail-heading"><span>{latest ? "Latest completed haul" : "Selected haul"}</span><span className="haul-record-number">{trip ? `#${String(trip.number).padStart(2, "0")}` : "--"}</span></div>
      <strong className="haul-detail-value">{fmt(trip?.efficiency, 2)}<small>t·km/L</small></strong>
      <p className="haul-detail-caption">Transport efficiency</p>
      <dl className="haul-detail-metrics">
        <div><dt>Payload delivered</dt><dd>{fmt(trip?.payloadT)} <small>t</small></dd></div>
        <div><dt>Estimated fuel</dt><dd>{fmt(trip?.fuelL)} <small>L</small></dd></div>
        <div><dt>Cycle distance</dt><dd>{fmt(trip?.distanceKm, 2)} <small>km</small></dd></div>
        <div><dt>Cycle duration</dt><dd>{fmt(trip?.durationMin)} <small>min</small></dd></div>
        <div><dt>Idle time</dt><dd>{fmt(trip?.idleMin)} <small>min</small></dd></div>
        <div><dt>Completed at</dt><dd>{trip ? timeLabel(trip.endedAtMs) : "--"}</dd></div>
      </dl>
      <div className="haul-detail-source"><span className="haul-source-mark" aria-hidden="true">◇</span>{sourceLabel(trip?.source ?? mode)} trip · fuel is estimated</div>
      <p className="haul-detail-note">Different loads, travel times and queue delays change the fuel used on each haul.</p>
    </aside>
  );
}

export interface HaulEfficiencyPanelProps {
  vehicles?: SupervisorVehicle[];
  world?: WorldState;
}

export function HaulEfficiencyPanel({ vehicles = [], world }: HaulEfficiencyPanelProps) {
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [limit, setLimit] = useState(DISPLAYED_TRIP_COUNT);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const recordsId = useId();
  const vehicleId = vehicles.some((vehicle) => vehicle.vehicleId === selectedVehicleId)
    ? selectedVehicleId : vehicles[0]?.vehicleId ?? "";
  const data = useHaulageEfficiencyData(vehicleId, limit, world?.mode);
  const trips = useMemo(() => selectEfficiencyTrips(data.history?.trips ?? [], vehicleId, limit), [data.history, vehicleId, limit]);
  const summary = summarizeTrips(trips);
  const latest = trips.at(-1) ?? null;
  const active = trips.find((trip) => trip.id === activeId) ?? latest;
  const capacity = world?.operations?.fleet?.[vehicleId]?.target_payload_tonnes;
  const mode = world?.mode;
  const simulated = trips.length > 0 ? trips.every((trip) => (trip.source ?? mode) === "SIMULATED") : mode === "SIMULATED";
  const source = simulated ? "SIMULATED" : mode;
  const updateLabel = data.error
    ? data.updatedAtMs ? `Refresh failed · showing data from ${timeLabel(data.updatedAtMs)}` : "Trip history unavailable · retrying every 30 seconds"
    : data.loading ? "Loading trip history" : STATIC_DEMO ? "Recorded demo history" : `Updated ${timeLabel(data.updatedAtMs!)} · every 30 sec`;

  if (!vehicles.length) {
    return <section className="supervisor-section haul-workspace"><div className="haul-empty"><h3>No fleet vehicles online</h3><p>Connect vehicle telemetry to view completed haul records.</p></div></section>;
  }

  return (
    <section className="supervisor-section haul-workspace" aria-labelledby="haul-page-title">
      <header className="haul-page-heading">
        <div><p className="eyebrow">Bailadila Deposit-14 · Production analysis</p><h3 id="haul-page-title">Haul efficiency</h3><p>See what each load delivers, and the fuel it takes to move it.</p></div>
        <div className="haul-provenance"><span className="haul-mode-badge"><span aria-hidden="true">◇</span> {source ?? "SOURCE UNKNOWN"}</span><span>Completed trips · estimated fuel</span></div>
      </header>

      <div className="haul-filters">
        <label htmlFor="efficiency-vehicle-select"><span>Truck</span><select id="efficiency-vehicle-select" value={vehicleId} onChange={(event) => { setSelectedVehicleId(event.target.value); setActiveId(null); }}>
          {vehicles.map((vehicle) => <option key={vehicle.vehicleId} value={vehicle.vehicleId}>{vehicle.vehicleId}{vehicle.isPrimary ? " · Primary" : ""}</option>)}
        </select></label>
        <label htmlFor="efficiency-window-select"><span>History window</span><select id="efficiency-window-select" value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setActiveId(null); }}><option value={15}>Last 15 hauls</option><option value={30}>Last 30 hauls</option></select></label>
        <div className="haul-vehicle-context">{capacity ? <><strong>{fmt(capacity, 0)} t</strong> rated payload</> : "Completed cycle analysis"}</div>
        <div className={`haul-data-status ${data.error ? "is-stale" : ""}`} role="status">{data.error && <span aria-hidden="true">⚠ </span>}{updateLabel}</div>
      </div>

      <div className="haul-kpis" aria-label="Selected haul window summary">
        <div className="haul-kpi"><span>Transport efficiency</span><strong>{fmt(summary.efficiency, 2)} <small>t·km/L</small></strong><p>Fuel-weighted across {summary.count} hauls</p></div>
        <div className="haul-kpi"><span>Average payload</span><strong>{fmt(summary.averagePayload)} <small>t</small></strong><p>{trips.length ? `${fmt(summary.minPayload)} to ${fmt(summary.maxPayload)} t per haul` : "Waiting for a completed load"}</p></div>
        <div className="haul-kpi"><span>Fuel per tonne</span><strong>{fmt(summary.fuelPerTonne, 3)} <small>L/t</small></strong><p>{fmt(trips.length ? summary.totalFuel : null)} L estimated total fuel</p></div>
        <div className="haul-kpi"><span>Payload moved</span><strong>{fmt(trips.length ? summary.totalPayload : null)} <small>t</small></strong><p>{summary.count} completed hauls · {vehicleId}</p></div>
      </div>

      <div className="haul-analysis">
        <article className="haul-trend-panel">
          <header className="haul-panel-heading"><div><h4>Haul-by-haul performance</h4><p>{vehicleId} · {trips.length} completed hauls, oldest to newest</p></div><div className="haul-legend" aria-label="Chart legend"><span><i className="haul-key-line" />Efficiency</span><span><i className="haul-key-bar" />Payload</span><span><i className="haul-key-average" />Window average</span></div></header>
          <HaulCycleChart trips={trips} vehicleId={vehicleId} activeId={active?.id === activeId ? activeId : null} onInspect={setActiveId} loading={data.loading} />
        </article>
        <TripDetail trip={active} mode={source} latest={active?.id === latest?.id} />
      </div>

      <div className="haul-insights">
        <div><span className="haul-insight-symbol" aria-hidden="true">↗</span><p><strong>{summary.best ? `Best in this window: ${fmt(summary.best.efficiency, 2)} t·km/L` : "Best haul appears after a cycle completes"}</strong><span>{summary.best ? `${fmt(summary.best.payloadT)} t moved using ${fmt(summary.best.fuelL)} L of estimated fuel.` : "Only completed trip records are compared."}</span></p></div>
        <p className="haul-method">Efficiency = payload × cycle distance ÷ estimated fuel. Higher means more transport work per litre. This is not a manufacturer fuel rating.</p>
      </div>

      <article className="haul-records">
        <header><div><h4>Haul records</h4><p>{simulated ? "Simulated history, including startup demonstration trips." : "Recorded trips for the selected truck."} The table and charts use the same data.</p></div><button type="button" aria-expanded={showRecords} aria-controls={recordsId} onClick={() => setShowRecords(!showRecords)}>{showRecords ? "Hide records" : `View ${trips.length} haul records`}<span aria-hidden="true">{showRecords ? " −" : " +"}</span></button></header>
        {showRecords && <div className="haul-table-scroll" id={recordsId} role="region" aria-label="Completed haul records" tabIndex={0}><table><caption>{vehicleId} · completed haul records · fuel values are estimates</caption><thead><tr><th scope="col">Haul</th><th scope="col">Completed</th><th scope="col">Payload, t</th><th scope="col">Fuel, L</th><th scope="col">Distance, km</th><th scope="col">Cycle, min</th><th scope="col">Efficiency, t·km/L</th><th scope="col">Source</th></tr></thead><tbody>{trips.map((trip) => <tr key={trip.id}><th scope="row">{String(trip.number).padStart(2, "0")}</th><td>{new Date(trip.endedAtMs).toLocaleDateString([], { month: "short", day: "numeric" })} {timeLabel(trip.endedAtMs)}</td><td>{fmt(trip.payloadT)}</td><td>{fmt(trip.fuelL)}</td><td>{fmt(trip.distanceKm, 2)}</td><td>{fmt(trip.durationMin)}</td><td>{fmt(trip.efficiency, 2)}</td><td>{sourceLabel(trip.source ?? mode)}</td></tr>)}</tbody></table>{!trips.length && <p className="haul-table-empty">No completed haul records available.</p>}</div>}
      </article>
    </section>
  );
}
