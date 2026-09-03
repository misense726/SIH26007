import { useEffect, useState } from "react";
import type { SimulationControlRequest, SimulationScenario, SimulationState } from "../types";
import {
  movementControl,
  resetControl,
  scenarioControl,
  sendSimulationControl,
} from "./simulationApi";

const bailadilaScenarios: Array<{ value: SimulationScenario; label: string; desc: string }> = [
  { value: "SCENARIO_1_DENSE_FOG", label: "S1: Dense Fog", desc: "15% visibility, synthetic overlay active" },
  { value: "SCENARIO_2_VEHICLE_AHEAD", label: "S2: Vehicle Ahead", desc: "Lead truck slows down, closing warning" },
  { value: "SCENARIO_3_OPPOSING_VEHICLE", label: "S3: Opposing Dumper", desc: "Narrow segment V2V collision alert" },
  { value: "SCENARIO_4_STATIC_OBSTACLE", label: "S4: Boulder Hazard", desc: "ToF detects rock, safe corridor turns RED" },
  { value: "SCENARIO_5_ROAD_CLOSURE_REROUTE", label: "S5: Dynamic Reroute", desc: "V2I closes ramp, auto alternate route" },
  { value: "SCENARIO_6_PAYLOAD_ROUTING", label: "S6: Payload Routing", desc: "100T gentle bypass vs 0T steep shortcut" },
  { value: "SCENARIO_7_FLEET_MONITORING", label: "S7: Fleet Monitoring", desc: "4 dumpers concurrent haulage cycles" },
  { value: "SCENARIO_8_HAULAGE_ANALYTICS", label: "S8: Haulage Analytics", desc: "Production KPIs, cycle times, delay review" },
];

const baselineScenarios: Array<{ value: SimulationScenario; label: string }> = [
  { value: "NORMAL", label: "Normal" },
  { value: "FOG", label: "Fog" },
  { value: "OBSTACLE", label: "Obstacle" },
  { value: "EMERGENCY", label: "Emergency" },
];

type RequestStatus = "IDLE" | "UPDATING" | "ERROR";

export function SimulationControls({ simulation }: { simulation: SimulationState }) {
  const [state, setState] = useState(simulation);
  const [status, setStatus] = useState<RequestStatus>("IDLE");
  const [viewGroup, setViewGroup] = useState<"bailadila" | "baseline">("bailadila");

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
    <section className="simulation-controls" aria-label="Simulation controls" aria-busy={busy}>
      <div className="simulation-control-heading">
        <span className="simulation-label">SIMULATION</span>
        <div>
          <p className="eyebrow">Scenario Engine</p>
          <strong>{state.running ? "Active Dispatch" : "Paused"}</strong>
        </div>

        <div className="scenario-group-toggle" role="group" aria-label="Scenario categories">
          <button
            type="button"
            className={`group-toggle-btn ${viewGroup === "bailadila" ? "active" : ""}`}
            onClick={() => setViewGroup("bailadila")}
          >
            Bailadila (1–8)
          </button>
          <button
            type="button"
            className={`group-toggle-btn ${viewGroup === "baseline" ? "active" : ""}`}
            onClick={() => setViewGroup("baseline")}
          >
            Baseline
          </button>
        </div>
      </div>

      {/* Scenario Buttons Grid */}
      <div className="scenario-buttons scenario-grid-bailadila" role="group" aria-label="Driving scenario">
        {viewGroup === "bailadila"
          ? bailadilaScenarios.map((scenario) => {
              const isActive = state.scenario === scenario.value;
              return (
                <button
                  key={scenario.value}
                  type="button"
                  className={`scenario-btn ${isActive ? "active" : ""}`}
                  aria-pressed={isActive}
                  disabled={busy}
                  onClick={() => apply(scenarioControl(scenario.value))}
                  title={scenario.desc}
                >
                  <strong>{scenario.label}</strong>
                  <small>{scenario.desc}</small>
                </button>
              );
            })
          : baselineScenarios.map((scenario) => {
              const isActive = state.scenario === scenario.value;
              return (
                <button
                  key={scenario.value}
                  type="button"
                  className={`scenario-${scenario.value.toLowerCase()} ${isActive ? "active" : ""}`}
                  aria-pressed={isActive}
                  disabled={busy}
                  onClick={() => apply(scenarioControl(scenario.value))}
                >
                  {scenario.label}
                </button>
              );
            })}
      </div>

      <div className="simulation-actions">
        <button type="button" disabled={busy} onClick={() => apply(movementControl(state.running))}>
          {state.running ? "Pause Fleet" : "Resume Fleet"}
        </button>
        <button type="button" disabled={busy} onClick={() => apply(resetControl())}>
          Reset Network
        </button>
      </div>

      {status !== "IDLE" && (
        <span className={`simulation-request-status status-${status.toLowerCase()}`} aria-live="polite">
          {status === "UPDATING" ? "Executing..." : "Controls unavailable"}
        </span>
      )}
    </section>
  );
}
