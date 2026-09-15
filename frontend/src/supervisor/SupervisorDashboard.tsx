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

type SupervisorSection = "fleet" | "efficiency" | "alerts" | "network";

const SECTION_LABELS: Array<{
  value: SupervisorSection;
  label: string;
  description: string;
}> = [
  { value: "fleet", label: "Fleet", description: "Vehicles and telemetry" },
  { value: "efficiency", label: "Efficiency", description: "Haul estimates" },
  { value: "alerts", label: "Alerts", description: "Issues and history" },
  { value: "network", label: "Network", description: "V2X coordination" },
];

function SectionIcon({ section }: { section: SupervisorSection }) {
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
  const [activeSection, setActiveSection] = useState<SupervisorSection>("fleet");
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
