import { useEffect, useState } from "react";
import type { HaulageMetrics, TripHistoryResponse } from "../types";
import { fetchHaulageMetrics, fetchTripHistory } from "../api/mineApi";
import { formatNumber } from "../state/selectors";
import { STATIC_DEMO } from "../simulation/demoMode";

interface HaulageAnalyticsTabProps {
  onSelectTruck?: (truckId: string) => void;
}

interface TruckPerformanceItem {
  vehicleId: string;
  callsign: string;
  tonnes: number;
  cycles: number;
  avgCycleMinutes: number;
  compliancePct: number;
  isUnderperforming: boolean;
  issueReason: string | null;
}

const CALLSIGN_MAP: Record<string, string> = {
  DUMPER_01: "Bailadila Shovel Hauler #01",
  DUMPER_02: "Komatsu 930E #02",
  DUMPER_03: "CAT 793F #03",
  HAULER_04: "BEML BH205E #04",
};

export function HaulageAnalyticsTab({ onSelectTruck }: HaulageAnalyticsTabProps) {
  const [metrics, setMetrics] = useState<HaulageMetrics | null>(null);
  const [history, setHistory] = useState<TripHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [m, h] = await Promise.all([
          fetchHaulageMetrics(),
          fetchTripHistory(30),
        ]);
        if (mounted) {
          setMetrics(m);
          setHistory(h);
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    }

    loadData();
    const interval = STATIC_DEMO ? null : setInterval(loadData, 2000);
    return () => {
      mounted = false;
      if (interval !== null) clearInterval(interval);
    };
  }, []);

  if (loading && !metrics) {
    return (
      <div className="analytics-loading-state" aria-live="polite">
        <div className="analytics-spinner" />
        <p>Loading haulage efficiency analytics...</p>
      </div>
    );
  }

  const bd = metrics?.cycle_time_breakdown;
  const dumperCount = metrics ? Object.keys(metrics.ore_moved_by_vehicle).length : null;

  // Compute per-truck performance analytics and identify underperforming vehicles
  const truckPerformanceList: TruckPerformanceItem[] = [];
  if (metrics) {
    const allVids = Array.from(
      new Set([
        ...Object.keys(metrics.ore_moved_by_vehicle),
        ...Object.keys(metrics.cycles_by_vehicle),
        "DUMPER_01",
        "DUMPER_02",
        "DUMPER_03",
        "HAULER_04",
      ]),
    );

    for (const vid of allVids) {
      const tonnes = metrics.ore_moved_by_vehicle[vid] ?? 0;
      const cycles = metrics.cycles_by_vehicle[vid] ?? 0;
      const vehTrips = history?.trips.filter((t) => t.vehicle_id === vid) ?? [];
      const avgCycleMinutes =
        vehTrips.length > 0
          ? vehTrips.reduce((acc, t) => acc + t.cycle_duration_s, 0) / (vehTrips.length * 60)
          : (bd?.total_cycle_minutes ?? 0);
      const compliancePct =
        vehTrips.length > 0
          ? vehTrips.reduce((acc, t) => acc + t.route_compliance_pct, 0) / vehTrips.length
          : (metrics.route_compliance_pct ?? 100);

      let isUnderperforming = false;
      let issueReason: string | null = null;

      if (cycles > 0 && compliancePct < 85.0) {
        isUnderperforming = true;
        issueReason = `Low route compliance (${compliancePct.toFixed(0)}% < 85%)`;
      } else if (cycles > 0 && avgCycleMinutes > 20.0) {
        isUnderperforming = true;
        issueReason = `High cycle time (${avgCycleMinutes.toFixed(1)}m > 18m benchmark)`;
      } else if (cycles === 0 && metrics.total_completed_cycles >= 4) {
        isUnderperforming = true;
        issueReason = "Zero completed cycles in shift";
      }

      truckPerformanceList.push({
        vehicleId: vid,
        callsign: CALLSIGN_MAP[vid] ?? vid,
        tonnes,
        cycles,
        avgCycleMinutes,
        compliancePct,
        isUnderperforming,
        issueReason,
      });
    }
  }

  const underperformingTrucks = truckPerformanceList.filter((t) => t.isUnderperforming);

  return (
    <div className="haulage-analytics-dashboard" aria-label="Haulage efficiency analytics">
      {/* 1. Header Summary */}
      <div className="analytics-header">
        <div>
          <p className="eyebrow">NMDC Bailadila Complex • Open-Cast Operations</p>
          <h2>Fleet Haulage Efficiency & Production KPIs</h2>
        </div>
        {metrics && (
          <div className="analytics-header-badges">
            <span className="analytics-shift-badge">Shift #1 (Day)</span>
            <span className="analytics-live-tag">
              {(metrics as { provenance?: string }).provenance === "LIVE_RUNTIME"
                ? "Live Ingest"
                : "Shift Telemetry"}
            </span>
          </div>
        )}
      </div>

      {/* 2. Primary KPI Stat Cards Row */}
      <div className="analytics-kpi-grid">
        <article className="analytics-kpi-card kpi-ore">
          <span className="kpi-label">Total Ore Moved</span>
          <div className="kpi-value-row">
            <strong className="kpi-main-val">
              {metrics ? formatNumber(metrics.total_ore_moved_tonnes, 0) : "--"}
            </strong>
            <span className="kpi-unit">Tonnes</span>
          </div>
          <span className="kpi-trend">Shift Target: 3,500 T</span>
        </article>

        <article className="analytics-kpi-card kpi-cycles">
          <span className="kpi-label">Completed Haul Cycles</span>
          <div className="kpi-value-row">
            <strong className="kpi-main-val">
              {metrics ? metrics.total_completed_cycles : "--"}
            </strong>
            <span className="kpi-unit">trips</span>
          </div>
          <span className="kpi-trend positive">
            {metrics?.route_compliance_pct != null
              ? `${metrics.route_compliance_pct.toFixed(0)}% Route Compliance`
              : "--"}
          </span>
        </article>

        <article className="analytics-kpi-card kpi-time">
          <span className="kpi-label">Average Cycle Time</span>
          <div className="kpi-value-row">
            <strong className="kpi-main-val">
              {bd ? bd.total_cycle_minutes.toFixed(1) : "--"}
            </strong>
            <span className="kpi-unit">minutes</span>
          </div>
          <span className="kpi-trend">Benchmark: 18.0 min</span>
        </article>

        <article className="analytics-kpi-card kpi-util">
          <span className="kpi-label">Fleet Utilization Rate</span>
          <div className="kpi-value-row">
            <strong className="kpi-main-val">
              {metrics ? metrics.fleet_utilization_pct.toFixed(1) : "--"}%
            </strong>
          </div>
          <span className="kpi-trend positive">Active Hauling Ratio</span>
        </article>

        <article className="analytics-kpi-card kpi-rate">
          <span className="kpi-label">Hourly Production Rate</span>
          <div className="kpi-value-row">
            <strong className="kpi-main-val">
              {metrics ? metrics.hourly_production_rate_tph.toFixed(0) : "--"}
            </strong>
            <span className="kpi-unit">TPH</span>
          </div>
          <span className="kpi-trend">Tonnes per Hour</span>
        </article>

        <article className="analytics-kpi-card kpi-fleet">
          <span className="kpi-label">Active Haul Fleet</span>
          <div className="kpi-value-row">
            <strong className="kpi-main-val">
              {metrics ? metrics.active_fleet_count : "--"}
            </strong>
            <span className="kpi-unit">dumpers</span>
          </div>
          <span className="kpi-trend">
            {metrics ? "All units tracked" : "--"}
          </span>
        </article>
      </div>

      {/* 3. Underperforming Trucks Section */}
      <article className="operations-card underperforming-section" aria-label="Fleet performance alerts">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Performance oversight</p>
            <h3>Truck Performance & Underperforming Alerts</h3>
          </div>
          <span className={`alert-count ${underperformingTrucks.length > 0 ? "alert-count-active" : ""}`}>
            {underperformingTrucks.length} Attention Needed
          </span>
        </div>

        {underperformingTrucks.length === 0 ? (
          <div className="alerts-empty">
            <span className="alerts-check">✓</span>
            <strong>All active dumpers operating within optimal cycle benchmarks.</strong>
          </div>
        ) : (
          <div className="underperforming-grid">
            {underperformingTrucks.map((truck) => (
              <div
                key={truck.vehicleId}
                className="underperforming-card"
                role="button"
                tabIndex={0}
                onClick={() => onSelectTruck?.(truck.vehicleId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTruck?.(truck.vehicleId);
                  }
                }}
              >
                <div className="underperforming-header">
                  <div>
                    <span className="badge-underperforming">UNDERPERFORMING</span>
                    <strong>{truck.callsign}</strong>
                    <span className="font-mono text-muted">{truck.vehicleId}</span>
                  </div>
                  <span className="inspect-truck-arrow" aria-hidden="true">➔</span>
                </div>
                <p className="underperforming-reason">⚠ {truck.issueReason}</p>
                <div className="underperforming-metrics">
                  <span>Ore: <strong>{truck.tonnes.toFixed(0)} T</strong></span>
                  <span>Cycles: <strong>{truck.cycles}</strong></span>
                  <span>Avg Cycle: <strong>{truck.avgCycleMinutes.toFixed(1)}m</strong></span>
                  <span>Compliance: <strong>{truck.compliancePct.toFixed(0)}%</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      {/* 4. Fleet Haulage Efficiency Comparison Table */}
      {truckPerformanceList.length > 0 && (
        <article className="operations-card efficiency-table-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Fleet-wide ranking</p>
              <h3>Haulage Efficiency of All Trucks</h3>
            </div>
            <span className="source-badge">{truckPerformanceList.length} Units Tracked</span>
          </div>

          <div className="trip-table-container">
            <table className="trip-history-table efficiency-table">
              <thead>
                <tr>
                  <th>Truck</th>
                  <th>Callsign</th>
                  <th>Ore Moved</th>
                  <th>Completed Cycles</th>
                  <th>Avg Cycle Time</th>
                  <th>Route Compliance</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {truckPerformanceList.map((t) => (
                  <tr
                    key={t.vehicleId}
                    className={`truck-row ${t.isUnderperforming ? "row-underperforming" : ""}`}
                    onClick={() => onSelectTruck?.(t.vehicleId)}
                  >
                    <td className="font-mono font-bold">{t.vehicleId}</td>
                    <td>{t.callsign}</td>
                    <td><strong>{t.tonnes.toFixed(0)} T</strong></td>
                    <td>{t.cycles} cycles</td>
                    <td>{t.avgCycleMinutes.toFixed(1)} min</td>
                    <td>
                      <span className={`compliance-badge ${t.compliancePct < 85 ? "badge-low-compliance" : ""}`}>
                        {t.compliancePct.toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span className={`performance-status-pill ${t.isUnderperforming ? "pill-warning" : "pill-optimal"}`}>
                        {t.isUnderperforming ? "NEEDS REVIEW" : "OPTIMAL"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="table-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTruck?.(t.vehicleId);
                        }}
                      >
                        Inspect Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {/* 5. Cycle Time Stage Distribution */}
      <div className="analytics-breakdown-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Cycle phase analysis</p>
            <h3>Haul Cycle Stage Time Breakdown</h3>
          </div>
          <span className="source-badge">
            Total Cycle: {bd ? `${bd.total_cycle_minutes.toFixed(1)}m` : "--"}
          </span>
        </div>

        {/* Multi-segment stacked visual bar */}
        <div className="cycle-stage-stacked-bar" aria-hidden="true">
          <div
            className="bar-segment seg-loading"
            style={{ width: `${bd?.loading_pct ?? 18}%` }}
            title={`Loading Wait: ${bd?.loading_wait_minutes ?? 3.2}m (${bd?.loading_pct ?? 18}%)`}
          />
          <div
            className="bar-segment seg-loaded-travel"
            style={{ width: `${bd?.loaded_travel_pct ?? 32}%` }}
            title={`Loaded Travel: ${bd?.loaded_travel_minutes ?? 5.8}m (${bd?.loaded_travel_pct ?? 32}%)`}
          />
          <div
            className="bar-segment seg-dumping"
            style={{ width: `${bd?.dumping_pct ?? 12}%` }}
            title={`Dumping Wait: ${bd?.dumping_wait_minutes ?? 2.1}m (${bd?.dumping_pct ?? 12}%)`}
          />
          <div
            className="bar-segment seg-empty-return"
            style={{ width: `${bd?.empty_return_pct ?? 28}%` }}
            title={`Empty Return: ${bd?.empty_return_minutes ?? 5.0}m (${bd?.empty_return_pct ?? 28}%)`}
          />
          <div
            className="bar-segment seg-idle"
            style={{ width: `${bd?.idle_pct ?? 10}%` }}
            title={`Idle / Pause: ${bd?.idle_minutes ?? 2.0}m (${bd?.idle_pct ?? 10}%)`}
          />
        </div>

        {/* Breakdown Legend Cards */}
        <div className="cycle-legend-grid">
          <div className="legend-item">
            <span className="legend-dot dot-loading" />
            <div className="legend-text">
              <span className="legend-name">Loading Wait</span>
              <strong>{bd?.loading_wait_minutes.toFixed(1)} min</strong>
              <small>{bd?.loading_pct.toFixed(1)}%</small>
            </div>
          </div>

          <div className="legend-item">
            <span className="legend-dot dot-loaded-travel" />
            <div className="legend-text">
              <span className="legend-name">Loaded Travel</span>
              <strong>{bd?.loaded_travel_minutes.toFixed(1)} min</strong>
              <small>{bd?.loaded_travel_pct.toFixed(1)}%</small>
            </div>
          </div>

          <div className="legend-item">
            <span className="legend-dot dot-dumping" />
            <div className="legend-text">
              <span className="legend-name">Dumping Wait</span>
              <strong>{bd?.dumping_wait_minutes.toFixed(1)} min</strong>
              <small>{bd?.dumping_pct.toFixed(1)}%</small>
            </div>
          </div>

          <div className="legend-item">
            <span className="legend-dot dot-empty-return" />
            <div className="legend-text">
              <span className="legend-name">Empty Return</span>
              <strong>{bd?.empty_return_minutes.toFixed(1)} min</strong>
              <small>{bd?.empty_return_pct.toFixed(1)}%</small>
            </div>
          </div>

          <div className="legend-item">
            <span className="legend-dot dot-idle" />
            <div className="legend-text">
              <span className="legend-name">Idle / Traffic Pause</span>
              <strong>{bd?.idle_minutes.toFixed(1)} min</strong>
              <small>{bd?.idle_pct.toFixed(1)}%</small>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Production by Vehicle & Operational Delay Notices */}
      <div className="analytics-lower-grid">
        {/* Production Tonnage per Dumper */}
        <article className="operations-card vehicle-tonnage-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Fleet contribution</p>
              <h3>Ore Moved by Vehicle</h3>
            </div>
            <span className="source-badge">
              {dumperCount != null ? `${dumperCount} Dumpers` : "--"}
            </span>
          </div>

          <div className="vehicle-tonnage-list">
            {metrics &&
              Object.entries(metrics.ore_moved_by_vehicle).map(([vid, tonnes]) => {
                const cycles = metrics.cycles_by_vehicle[vid] ?? 0;
                const maxT = Math.max(100, ...Object.values(metrics.ore_moved_by_vehicle));
                const pct = (tonnes / maxT) * 100;
                return (
                  <div
                    key={vid}
                    className="veh-tonnage-row clickable-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectTruck?.(vid)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectTruck?.(vid);
                      }
                    }}
                  >
                    <div className="veh-tonnage-meta">
                      <strong>{CALLSIGN_MAP[vid] ?? vid}</strong>
                      <span>{cycles} completed cycles</span>
                    </div>
                    <div className="veh-bar-container">
                      <div className="veh-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="veh-tonnes-val">
                      <strong>{tonnes.toFixed(0)} T</strong>
                    </div>
                  </div>
                );
              })}
          </div>
        </article>

        {/* Operational Delay Notices */}
        <article className="operations-card delay-events-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Dispatch log</p>
              <h3>Operational Delays & Events</h3>
            </div>
            <span className="source-badge">Automated</span>
          </div>

          <div className="delay-events-list">
            {metrics?.recent_delay_events.map((delay, idx) => (
              <div key={idx} className="delay-event-item">
                <span className="delay-bullet">⚠</span>
                <p>{delay}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      {/* 7. Completed Haul Trips History Table */}
      <article className="operations-card trip-history-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Logged cycles</p>
            <h3>Recent Completed Trips History</h3>
          </div>
          <span className="source-badge">
            {history?.total_trips ?? 0} Recorded Trips
          </span>
        </div>

        <div className="trip-table-container">
          <table className="trip-history-table">
            <thead>
              <tr>
                <th>Trip ID</th>
                <th>Vehicle</th>
                <th>Extraction Bench</th>
                <th>Dump Point</th>
                <th>Payload</th>
                <th>Cycle Time</th>
                <th>Distance</th>
                <th>Avg Speed</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {history?.trips.map((t) => (
                <tr
                  key={t.trip_id}
                  className="clickable-trip-row"
                  onClick={() => onSelectTruck?.(t.vehicle_id)}
                >
                  <td className="font-mono text-muted">{t.trip_id}</td>
                  <td><strong>{t.callsign}</strong></td>
                  <td>{t.pickup_node.replace("PICKUP_", "").replace("_", " ")}</td>
                  <td>{t.dump_node.replace("DUMP_", "").replace("_", " ")}</td>
                  <td>
                    <span className="payload-cell-badge">
                      {t.payload_tonnes.toFixed(0)} T
                    </span>
                  </td>
                  <td>{(t.cycle_duration_s / 60.0).toFixed(1)} min</td>
                  <td>{t.distance_km.toFixed(2)} km</td>
                  <td>{t.avg_speed_kmh.toFixed(1)} km/h</td>
                  <td>
                    <span className="compliance-badge">
                      {t.route_compliance_pct.toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
              {(!history || history.trips.length === 0) && (
                <tr>
                  <td colSpan={9} className="text-center text-muted">
                    No completed haul trips recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
