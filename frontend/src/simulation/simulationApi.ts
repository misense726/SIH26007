import type {
  SimulationControlRequest,
  SimulationScenario,
  SimulationState,
} from "../types";

type RequestClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readSimulationState(response: Response): Promise<SimulationState> {
  if (!response.ok) {
    throw new Error(`Simulation request failed with status ${response.status}`);
  }
  return response.json() as Promise<SimulationState>;
}

export async function loadSimulationState(
  request: RequestClient = fetch,
): Promise<SimulationState> {
  return readSimulationState(await request("/api/simulation"));
}

export async function sendSimulationControl(
  control: SimulationControlRequest,
  request: RequestClient = fetch,
): Promise<SimulationState> {
  const response = await request("/api/simulation/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(control),
  });
  return readSimulationState(response);
}

export function scenarioControl(scenario: SimulationScenario): SimulationControlRequest {
  return { scenario };
}

export function movementControl(running: boolean): SimulationControlRequest {
  return { running: !running };
}

export function resetControl(): SimulationControlRequest {
  return { reset: true };
}
