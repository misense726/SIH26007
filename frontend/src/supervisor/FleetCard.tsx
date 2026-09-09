import { formatNumber } from "../state/selectors";
import type { SupervisorVehicle, SupervisorVehicleTone } from "./supervisorViewModel";

interface FleetCardProps {
  truck: SupervisorVehicle;
  isSelected?: boolean;
  onSelect?: () => void;
}

const TONE_LABELS: Record<SupervisorVehicleTone, string> = {
  nominal: "Nominal",
  attention: "Needs attention",
  critical: "Critical",
  lost: "Contact lost",
  unknown: "Position unknown",
};

export function formatTelemetryAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "Unknown";
  if (ageMs < 1_000) return "Now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s ago`;
  return `${Math.round(ageMs / 60_000)}m ago`;
}

export function FleetCard({ truck, isSelected, onSelect }: FleetCardProps) {
  const linkLabel = truck.isPrimary
    ? "Direct"
    : truck.linkStatus
      ? truck.linkStatus.toLowerCase()
      : "Not reported";

  return (
    <article className={`fleet-row fleet-row-${truck.tone} ${isSelected ? "fleet-row-selected" : ""}`}>
      <button
        type="button"
        className="fleet-row-button"
        onClick={onSelect}
        aria-pressed={Boolean(isSelected)}
        aria-label={`View ${truck.vehicleId} details`}
      >
        <span className="fleet-cell fleet-identity-cell" data-label="Vehicle">
          <span
            className={`fleet-vehicle-marker ${truck.isPrimary ? "fleet-vehicle-marker-primary" : "fleet-vehicle-marker-peer"}`}
            aria-hidden="true"
          />
          <span>
            <strong>{truck.vehicleId}</strong>
            <small>{truck.sourceLabel}</small>
          </span>
        </span>

        <span className="fleet-cell fleet-state-cell" data-label="State">
          <span className={`status-symbol status-symbol-${truck.tone}`} aria-hidden="true" />
          <span>
            <strong>{TONE_LABELS[truck.tone]}</strong>
            <small>{truck.emergencyState?.replaceAll("_", " ") ?? "Safety unavailable"}</small>
          </span>
        </span>

        <span className="fleet-cell fleet-value-cell" data-label="Speed">
          <strong>{truck.hasPosition ? formatNumber(truck.speedMps * 3.6, 1) : "--"}</strong>
          <small>{truck.hasPosition ? "km/h" : "Awaiting GPS fix"}</small>
        </span>

        <span className="fleet-cell fleet-value-cell" data-label="Position">
          <strong>{truck.hasPosition ? `${formatNumber(truck.xM, 1)}, ${formatNumber(truck.yM, 1)}` : "--"}</strong>
          <small>{truck.hasPosition ? "local metres" : "Not available"}</small>
        </span>

        <span className="fleet-cell fleet-value-cell" data-label="Connection">
          <strong className={`fleet-link fleet-link-${truck.linkStatus?.toLowerCase() ?? "direct"}`}>
            {linkLabel}
          </strong>
          <small>{formatTelemetryAge(truck.ageMs)}</small>
        </span>

        <span className="fleet-row-chevron" aria-hidden="true">›</span>
      </button>
    </article>
  );
}
