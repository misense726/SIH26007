import { useEffect, useState } from "react";
import type { SimulationControlRequest, SimulationScenario, SimulationState } from "../types";
import {
  movementControl,
  resetControl,
  scenarioControl,
  sendSimulationControl,
} from "./simulationApi";

const scenarios: Array<{ value: SimulationScenario; label: string }> = [
  { value: "NORMAL", label: "Normal" },
  { value: "FOG", label: "Fog" },
  { value: "OBSTACLE", label: "Obstacle" },
  { value: "EMERGENCY", label: "Emergency" },
];

type RequestStatus = "IDLE" | "UPDATING" | "ERROR";

export function SimulationControls({ simulation }: { simulation: SimulationState }) {
  const [state, setState] = useState(simulation);
  const [status, setStatus] = useState<RequestStatus>("IDLE");

  useEffect(() => setState(simulation), [simulation]);

  async function apply(control: SimulationControlRequest) {
    setStatus("UPDATING");
    try {
      setState(await sendSimulationControl(control));
      setStatus("IDLE");
    } catch {
      setStatus("ERROR");
    }
  }

  const busy = status === "UPDATING";

  return (
    <section className="simulation-controls" aria-label="Simulation controls">
      <div className="simulation-control-heading">
        <span className="simulation-label">SIMULATED</span>
        <div>
          <p className="eyebrow">Scenario</p>
          <strong>{state.running ? "Running" : "Paused"}</strong>
        </div>
      </div>

      <div className="scenario-buttons" role="group" aria-label="Driving scenario">
        {scenarios.map((scenario) => (
          <button
            key={scenario.value}
            type="button"
            className={`scenario-${scenario.value.toLowerCase()} ${state.scenario === scenario.value ? "active" : ""}`}
            aria-pressed={state.scenario === scenario.value}
            disabled={busy}
            onClick={() => apply(scenarioControl(scenario.value))}
          >
            {scenario.label}
          </button>
        ))}
      </div>

      <div className="simulation-actions">
        <button type="button" disabled={busy} onClick={() => apply(movementControl(state.running))}>
          {state.running ? "Pause" : "Resume"}
        </button>
        <button type="button" disabled={busy} onClick={() => apply(resetControl())}>
          Reset route
        </button>
      </div>

      <span className={`simulation-request-status status-${status.toLowerCase()}`} aria-live="polite">
        {status === "UPDATING" ? "Applying" : status === "ERROR" ? "Controls unavailable" : "Ready"}
      </span>
    </section>
  );
}
