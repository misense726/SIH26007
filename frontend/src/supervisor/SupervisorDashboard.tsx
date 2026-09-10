import { useEffect, useMemo, useState } from "react";
import { SensorHealthList } from "../components/SensorHealthList";
import { formatNumber } from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import { TwinMap } from "../twin/TwinMap";
import type { AlertEvent, WorldState } from "../types";
import { FleetCard, formatTelemetryAge } from "./FleetCard";
import { HaulEfficiencyPanel } from "./HaulEfficiencyPanel";
import {
  createSupervisorViewModel,
  type SupervisorIssue,
  type SupervisorVehicle,
} from "./supervisorViewModel";
import { V2XPanel } from "./V2XPanel";
import { VehicleSensors } from "./VehicleSensors";

interface SupervisorDashboardProps {
  world: WorldState;
  connection: ConnectionState;
}
type SupervisorSection = "overview" | "fleet" | "efficiency" | "alerts" | "network";

const SECTION_LABELS: Array<{
  value: SupervisorSection;
  label: string;
  description: string;
}> = [
  { value: "overview", label: "Overview", description: "Operational picture" },
  { value: "fleet", label: "Fleet", description: "Vehicles and telemetry" },
  { value: "efficiency", label: "Efficiency", description: "Haul estimates" },
  { value: "alerts", label: "Alerts", description: "Issues and history" },
  { value: "network", label: "Network", description: "V2X coordination" },
];

function SectionIcon({ section }: { section: SupervisorSection }) {
  if (section === "overview") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="18" height="7" rx="1.5" /></svg>;
  }
  if (section === "fleet") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16V9l3-3h10l3 3v7" /><path d="M6 13h12M7 18h2M15 18h2M7 6l1-3h8l1 3" /></svg>;
  }
  if (section === "efficiency") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /><circle cx="7" cy="15" r="1" /><circle cx="11" cy="11" r="1" /><circle cx="14" cy="13" r="1" /><circle cx="19" cy="7" r="1" /></svg>;
  }
  if (section === "alerts") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5M12 17.5h.01" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.3 4.3a11 11 0 0 0 0 15.4M19.7 4.3a11 11 0 0 1 0 15.4" /></svg>;
}

function formatEventTime(timestampMs: number): string {
  if (!timestampMs) return "Time unavailable";
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function IssueItem({
  issue,
  onOpenVehicle,
}: {
  issue: SupervisorIssue;
  onOpenVehicle: (vehicleId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`supervisor-issue supervisor-issue-${issue.severity.toLowerCase()}`}
      onClick={() => onOpenVehicle(issue.vehicleId)}
    >
      <span className="issue-severity-symbol" aria-hidden="true">{issue.severity === "CRITICAL" ? "!" : "•"}</span>
      <span className="issue-copy">
        <span className="issue-meta">{issue.kind} · {issue.vehicleId}</span>
        <strong>{issue.title}</strong>
        <small>{issue.detail}</small>
      </span>
      <span className="issue-open-label">Inspect</span>
    </button>
  );
}

function HistoryItem({ event }: { event: AlertEvent }) {
  return (
    <article className={`supervisor-history-item history-${event.severity.toLowerCase()}`}>
      <span className="history-severity" aria-hidden="true" />
      <div>
        <span className="history-meta">{formatEventTime(event.timestamp_ms)} · {event.vehicle_id}</span>
        <strong>{event.title}</strong>
        <p>{event.detail}</p>
      </div>
      <span className="history-label">{event.severity}</span>
    </article>
  );
}

function SelectedVehiclePanel({
  vehicle,
  primary,
  referenceTimeMs,
}: {
  vehicle: SupervisorVehicle | null;
  primary: ReturnType<typeof createSupervisorViewModel>["primary"];
  referenceTimeMs: number;
}) {
  if (!vehicle) {
    return (
      <article className="supervisor-panel selected-vehicle-panel">
        <div className="supervisor-empty-state">
          <span aria-hidden="true">◇</span>
          <strong>Select a vehicle</strong>
          <p>Choose a fleet row or map marker to inspect its telemetry.</p>
        </div>
      </article>
    );
  }

  const isPrimary = vehicle.isPrimary && primary;
  return (
    <article className="supervisor-panel selected-vehicle-panel">
      <header className="supervisor-panel-heading selected-vehicle-heading">
        <div>
          <p className="eyebrow">Selected vehicle</p>
          <h3>{vehicle.vehicleId}</h3>
        </div>
        <span className={`selected-status selected-status-${vehicle.tone}`}>
          <i aria-hidden="true" />{vehicle.tone.replaceAll("_", " ")}
        </span>
      </header>

      <div className="selected-vehicle-metrics">
        <div><span>Speed</span><strong>{vehicle.hasPosition ? `${formatNumber(vehicle.speedMps * 3.6, 1)} km/h` : "Unavailable"}</strong></div>
        <div><span>Heading</span><strong>{vehicle.hasPosition ? `${formatNumber(vehicle.headingDeg, 0)}°` : "Unavailable"}</strong></div>
        <div><span>Position</span><strong>{vehicle.hasPosition ? `${formatNumber(vehicle.xM, 1)}, ${formatNumber(vehicle.yM, 1)} m` : "Awaiting GPS fix"}</strong></div>
        <div><span>Last update</span><strong>{formatTelemetryAge(Math.max(0, referenceTimeMs - vehicle.lastUpdateMs))}</strong></div>
      </div>

      {isPrimary ? (
        <>
          <div className="primary-only-note">
            <span>PRIMARY TELEMETRY</span>
            Environment, corridor, and sensor values belong to this vehicle.
          </div>
          <div className="selected-primary-grid">
            <div>
              <span>Nearest obstacle</span>
              <strong>{primary.nearestObstacleM === null ? "--" : `${formatNumber(primary.nearestObstacleM, 2)} m`}</strong>
            </div>
            <div>
              <span>Visibility</span>
              <strong>{primary.visibilityPercent}% · {primary.visibilityState.replaceAll("_", " ")}</strong>
            </div>
            <div>
              <span>Safe corridor</span>
              <strong>{primary.corridorState} · {Math.round(primary.corridorConfidence * 100)}%</strong>
            </div>
            <div>
              <span>Environment</span>
              <strong>{formatNumber(primary.temperatureC)}°C · {formatNumber(primary.pressureHpa, 0)} hPa</strong>
            </div>
          </div>
          <div className="selected-sensor-section">
            <div className="selected-sensor-heading">
              <span>Range sensor health</span>
              <strong>{primary.sensorSummary.healthy}/{primary.sensorSummary.total} healthy</strong>
            </div>
            <SensorHealthList sensors={primary.sensors} referenceTimestampMs={referenceTimeMs} />
          </div>
        </>
      ) : (
        <div className="peer-telemetry-note">
          <strong>{vehicle.sourceLabel}</strong>
          <p>
            {vehicle.hasPosition
              ? "This peer reports position, motion, and coordination status. Environment and range-sensor data are unavailable for this vehicle."
              : "The vehicle is connected. Position and movement will appear after its GPS reports a valid fix."}
          </p>
          <dl>
            <div><dt>Link</dt><dd>{vehicle.linkStatus?.toLowerCase() ?? "Not reported"}</dd></div>
            <div><dt>Distance to primary</dt><dd>{vehicle.distanceM === null ? "--" : `${formatNumber(vehicle.distanceM, 1)} m`}</dd></div>
            <div><dt>Safety report</dt><dd>{vehicle.emergencyState?.replaceAll("_", " ") ?? "Unavailable"}</dd></div>
          </dl>
        </div>
      )}
    </article>
  );
}

export function SupervisorDashboard({ world, connection }: SupervisorDashboardProps) {
  const model = useMemo(() => createSupervisorViewModel(world), [world]);
  const hasHaulRoute = world.mode === "SIMULATED" && Boolean(world.haul_route);
  const [activeSection, setActiveSection] = useState<SupervisorSection>(hasHaulRoute ? "fleet" : "overview");
  useEffect(() => { if (hasHaulRoute) setActiveSection("fleet"); }, [hasHaulRoute]);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(world.primary_vehicle_id);

  useEffect(() => {
    if (model.vehicles.length === 0) {
      setSelectedTruckId(null);
      return;
    }
    if (!model.vehicles.some((vehicle) => vehicle.vehicleId === selectedTruckId)) {
      setSelectedTruckId(model.primary?.vehicle.vehicleId ?? model.vehicles[0].vehicleId);
    }
  }, [model.vehicles, model.primary, selectedTruckId]);

  if (connection !== "CONNECTED") {
    const connecting = connection === "CONNECTING";
    return (
      <section className="dashboard supervisor-dashboard" aria-label="Supervisor workspace">
        <header className="supervisor-hero">
          <div>
            <p className="eyebrow">Supervisor workspace</p>
            <h2>Fleet command</h2>
            <p>One operational picture for vehicles, safety exceptions, and coordination.</p>
          </div>
          <span className={`supervisor-live-state ${connecting ? "is-connecting" : "is-offline"}`}>
            <i aria-hidden="true" />{connecting ? "Opening telemetry" : "Telemetry offline"}
          </span>
        </header>
        <article className="supervisor-panel supervisor-offline-panel" role={connecting ? "status" : "alert"}>
          <span className="offline-symbol" aria-hidden="true">∿</span>
          <p className="eyebrow">Fleet data</p>
          <h3>{connecting ? "Establishing a live feed" : "The operational picture is unavailable"}</h3>
          <p>{connecting ? "Waiting for the first complete fleet snapshot." : "Vehicle positions, conditions, and safety states cannot be verified."}</p>
        </article>
      </section>
    );
  }

  const selectedVehicle = model.vehicles.find((vehicle) => vehicle.vehicleId === selectedTruckId) ?? null;
  const positionedVehicles = model.vehicles.filter((vehicle) => vehicle.hasPosition);
  const criticalIssues = model.issues.filter((issue) => issue.severity === "CRITICAL").length;
  const attentionCount = model.counts.attention + model.counts.critical + model.counts.lost + model.counts.unknown;

  const openVehicle = (vehicleId: string) => {
    setSelectedTruckId(vehicleId);
    setActiveSection("fleet");
  };

  return (
    <section className="dashboard supervisor-dashboard" aria-label="Supervisor workspace">
      <header className="supervisor-hero">
        <div>
          <p className="eyebrow">Supervisor workspace</p>
          <h2>Fleet command</h2>
          <p>{model.mapName}</p>
        </div>
      </header>

      <nav className="supervisor-section-nav" aria-label="Supervisor sections">
        {SECTION_LABELS.map((section) => {
          const badge = section.value === "alerts" && model.issues.length > 0
            ? model.issues.length
            : section.value === "fleet"
              ? model.counts.total
              : null;
          return (
            <button
              key={section.value}
              type="button"
              className={activeSection === section.value ? "active" : ""}
              onClick={() => setActiveSection(section.value)}
              aria-current={activeSection === section.value ? "page" : undefined}
            >
              <SectionIcon section={section.value} />
              <span><strong>{section.label}</strong><small>{section.description}</small></span>
              {badge !== null && <b>{badge}</b>}
            </button>
          );
        })}
      </nav>

      <VehicleSensors world={world} />

      {activeSection === "overview" && (
        <div className="supervisor-section supervisor-overview-section">
          <div className="supervisor-kpi-grid" aria-label="Fleet summary">
            <article className="supervisor-kpi kpi-online">
              <span className="kpi-label">Fleet available</span>
              <strong>{model.counts.online}<small> / {model.counts.total}</small></strong>
              <p><i aria-hidden="true" />{model.counts.online === model.counts.total ? "All known vehicles reporting" : `${model.counts.total - model.counts.online} awaiting telemetry`}</p>
            </article>
            <article className={`supervisor-kpi ${attentionCount > 0 ? "kpi-attention" : "kpi-clear"}`}>
              <span className="kpi-label">Needs attention</span>
              <strong>{attentionCount}</strong>
              <p><i aria-hidden="true" />{attentionCount === 0 ? "No fleet exceptions" : "Vehicles outside nominal state"}</p>
            </article>
            <article className={`supervisor-kpi ${criticalIssues > 0 ? "kpi-critical" : "kpi-clear"}`}>
              <span className="kpi-label">Critical issues</span>
              <strong>{criticalIssues}</strong>
              <p><i aria-hidden="true" />{criticalIssues === 0 ? "No critical exceptions" : "Immediate review required"}</p>
            </article>
            <article className={`supervisor-kpi visibility-${model.primary?.visibilityState.toLowerCase().replaceAll("_", "-") ?? "unknown"}`}>
              <span className="kpi-label">Primary visibility</span>
              <strong>{model.primary ? `${model.primary.visibilityPercent}%` : "--"}</strong>
              <p><i aria-hidden="true" />{model.primary?.visibilityState.replaceAll("_", " ") ?? "Unavailable"}</p>
            </article>
          </div>

          <div className="overview-command-grid">
            <article className="supervisor-panel supervisor-map-panel">
              <header className="supervisor-panel-heading">
                <div><p className="eyebrow">Operational map</p><h3>{model.mapName}</h3></div>
                <div className="supervisor-panel-actions">
                  {model.primary && <span className="panel-context-label">Focused on {model.primary.vehicle.vehicleId}</span>}
                  <button type="button" className="panel-text-action" onClick={() => setActiveSection("fleet")}>Open fleet view</button>
                </div>
              </header>
              <TwinMap
                mode={world.mode}
                haul={world.haul_route}
                vehicles={positionedVehicles}
                features={world.reference_map?.features ?? []}
                mapName={model.mapName}
                selectedTruckId={selectedTruckId}
                onSelectTruck={setSelectedTruckId}
              />
            </article>

            <aside className="supervisor-panel exception-queue-panel">
              <header className="supervisor-panel-heading">
                <div><p className="eyebrow">Exception queue</p><h3>What needs action</h3></div>
                <span className={`exception-count ${model.issues.length > 0 ? "has-issues" : ""}`}>{model.issues.length}</span>
              </header>
              {model.issues.length === 0 ? (
                <div className="supervisor-empty-state compact"><span aria-hidden="true">✓</span><strong>No active exceptions</strong><p>All reported fleet states are nominal.</p></div>
              ) : (
                <div className="supervisor-issue-list">
                  {model.issues.slice(0, 5).map((issue) => <IssueItem key={issue.id} issue={issue} onOpenVehicle={openVehicle} />)}
                </div>
              )}
              {model.issues.length > 5 && <button type="button" className="panel-footer-action" onClick={() => setActiveSection("alerts")}>View all {model.issues.length} issues</button>}
            </aside>
          </div>

          <div className="overview-secondary-grid">
            <article className="supervisor-panel primary-summary-panel">
              <header className="supervisor-panel-heading">
                <div><p className="eyebrow">Primary vehicle</p><h3>{model.primary?.vehicle.vehicleId ?? "Unavailable"}</h3></div>
                <button type="button" className="panel-text-action" onClick={() => model.primary && openVehicle(model.primary.vehicle.vehicleId)}>Inspect telemetry</button>
              </header>
              {model.primary ? (
                <div className="primary-summary-grid">
                  <div><span>Nearest obstacle</span><strong>{model.primary.nearestObstacleM === null ? "--" : `${formatNumber(model.primary.nearestObstacleM, 2)} m`}</strong></div>
                  <div><span>Safe corridor</span><strong>{model.primary.corridorState}</strong><small>{Math.round(model.primary.corridorConfidence * 100)}% confidence</small></div>
                  <div><span>Range sensors</span><strong>{model.primary.sensorSummary.healthy}/{model.primary.sensorSummary.total}</strong><small>healthy</small></div>
                  <div><span>Relative altitude</span><strong>{formatNumber(model.primary.relativeAltitudeM, 2)} m</strong><small>approximate</small></div>
                </div>
              ) : <div className="supervisor-empty-state compact"><strong>Primary vehicle missing</strong><p>The designated vehicle is not present in the current snapshot.</p></div>}
            </article>

            <article className="supervisor-panel recent-history-panel">
              <header className="supervisor-panel-heading">
                <div><p className="eyebrow">Event history</p><h3>Most recent</h3></div>
                <button type="button" className="panel-text-action" onClick={() => setActiveSection("alerts")}>Open history</button>
              </header>
              {model.history.length === 0 ? (
                <div className="supervisor-empty-state compact"><span aria-hidden="true">✓</span><strong>No recorded events</strong><p>Historical safety events will appear here.</p></div>
              ) : (
                <div className="supervisor-history-list compact-history-list">
                  {model.history.slice(0, 3).map((event) => <HistoryItem key={event.event_id} event={event} />)}
                </div>
              )}
            </article>
          </div>
        </div>
      )}

      {activeSection === "fleet" && (
        <div className="supervisor-section supervisor-fleet-section">
          <article className="supervisor-panel supervisor-map-panel fleet-page-map">
            <header className="supervisor-panel-heading">
              <div><p className="eyebrow">Fleet location</p><h3>{model.mapName}</h3></div>
              <span className="panel-context-label">Select a marker or vehicle row</span>
            </header>
            <TwinMap
              mode={world.mode}
              haul={world.haul_route}
              vehicles={positionedVehicles}
              features={world.reference_map?.features ?? []}
              mapName={model.mapName}
              selectedTruckId={selectedTruckId}
              onSelectTruck={setSelectedTruckId}
            />
          </article>

          <div className="fleet-detail-grid">
            <article className="supervisor-panel fleet-directory-panel">
              <header className="supervisor-panel-heading">
                <div><p className="eyebrow">Fleet directory</p><h3>{model.counts.total} known vehicles</h3></div>
                <span className="panel-context-label">Exceptions first</span>
              </header>
              <div className="fleet-table-heading" aria-hidden="true">
                <span>Vehicle</span><span>State</span><span>Speed</span><span>Position</span><span>Connection</span><span />
              </div>
              <div className="fleet-row-list">
                {model.vehicles.map((vehicle) => (
                  <FleetCard
                    key={vehicle.vehicleId}
                    truck={vehicle}
                    isSelected={selectedTruckId === vehicle.vehicleId}
                    onSelect={() => setSelectedTruckId(vehicle.vehicleId)}
                  />
                ))}
                {model.vehicles.length === 0 && <div className="supervisor-empty-state"><strong>No vehicle telemetry</strong></div>}
              </div>
            </article>
            <SelectedVehiclePanel vehicle={selectedVehicle} primary={model.primary} referenceTimeMs={model.referenceTimeMs} />
          </div>
        </div>
      )}

      {activeSection === "alerts" && (
        <div className="supervisor-section alerts-workspace-grid">
          <article className="supervisor-panel active-issues-panel">
            <header className="supervisor-panel-heading">
              <div><p className="eyebrow">Current state</p><h3>Active exceptions</h3></div>
              <span className={`exception-count ${model.issues.length > 0 ? "has-issues" : ""}`}>{model.issues.length}</span>
            </header>
            {model.issues.length === 0 ? (
              <div className="supervisor-empty-state"><span aria-hidden="true">✓</span><strong>No active exceptions</strong><p>The reported fleet state is nominal.</p></div>
            ) : (
              <div className="supervisor-issue-list">
                {model.issues.map((issue) => <IssueItem key={issue.id} issue={issue} onOpenVehicle={openVehicle} />)}
              </div>
            )}
          </article>
          <article className="supervisor-panel history-panel">
            <header className="supervisor-panel-heading">
              <div><p className="eyebrow">Recorded events</p><h3>Safety history</h3></div>
              <span className="panel-context-label">Newest first</span>
            </header>
            {model.history.length === 0 ? (
              <div className="supervisor-empty-state"><span aria-hidden="true">○</span><strong>No historical events</strong><p>Cleared and recorded safety events will appear here.</p></div>
            ) : (
              <div className="supervisor-history-list">
                {model.history.map((event) => <HistoryItem key={event.event_id} event={event} />)}
              </div>
            )}
          </article>
        </div>
      )}

      {activeSection === "efficiency" && (
        <HaulEfficiencyPanel vehicles={model.vehicles} world={world} />
      )}

      {activeSection === "network" && (
        <div className="supervisor-section">
          <V2XPanel v2x={world.v2x} />
        </div>
      )}
    </section>
  );
}
