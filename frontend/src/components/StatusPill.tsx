import type { ConnectionState } from "../state/useTelemetry";
import type { DataMode } from "../types";

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const label = state === "DISCONNECTED" ? "OFFLINE" : state;
  return (
    <span
      className={`connection connection-${state.toLowerCase()}`}
      role="status"
      aria-live="polite"
      aria-label={`Telemetry ${label.toLowerCase()}`}
    >
      {label}
    </span>
  );
}

export function ModePill({ mode }: { mode: DataMode }) {
  return (
    <span className={`mode-pill mode-${mode.toLowerCase()}`} title={`Data source: ${mode}`}>
      {mode}
    </span>
  );
}
