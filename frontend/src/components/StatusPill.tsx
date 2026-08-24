import type { ConnectionState } from "../state/useTelemetry";
import type { DataMode } from "../types";

export function ConnectionPill({ state }: { state: ConnectionState }) {
  return <span className={`connection connection-${state.toLowerCase()}`}>{state}</span>;
}

export function ModePill({ mode }: { mode: DataMode }) {
  return <span className={`mode-pill mode-${mode.toLowerCase()}`}>{mode}</span>;
}

