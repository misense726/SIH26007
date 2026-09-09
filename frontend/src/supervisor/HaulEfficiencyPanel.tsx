import { useMemo, useState } from "react";

type VehicleId = "DUMPER_01" | "DUMPER_02";

interface HaulInputs {
  vehicleId: VehicleId;
  payloadT: number;
  cycleDistanceKm: number;
  mileageKmPerL: number;
  cycleMinutes: number;
}

interface HaulLog extends HaulInputs {
  id: string;
  loggedAt: number;
  fuelPerCycleL: number;
  efficiencyTonneKmPerL: number;
  throughputTph: number;
}

const STORAGE_KEY = "fogsen.haul-efficiency.v1";
const MAX_LOGS = 40;

const DEFAULT_INPUTS: HaulInputs = {
  vehicleId: "DUMPER_01",
  payloadT: 25,
  cycleDistanceKm: 4.8,
  mileageKmPerL: 2.2,
  cycleMinutes: 18,
};

function readLogs(): HaulLog[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.loggedAt === "number").slice(-MAX_LOGS) : [];
  } catch {
    return [];
  }
}

function calculate(inputs: HaulInputs) {
  if (inputs.payloadT <= 0 || inputs.cycleDistanceKm <= 0 || inputs.mileageKmPerL <= 0 || inputs.cycleMinutes <= 0) {
    return { fuelPerCycleL: 0, efficiencyTonneKmPerL: 0, throughputTph: 0 };
  }
  const fuelPerCycleL = inputs.cycleDistanceKm / inputs.mileageKmPerL;
  return {
    fuelPerCycleL,
    efficiencyTonneKmPerL: (inputs.payloadT * inputs.cycleDistanceKm) / fuelPerCycleL,
    throughputTph: inputs.payloadT * (60 / inputs.cycleMinutes),
  };
}

function metric(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function EfficiencyGraph({ logs, preview }: { logs: HaulLog[]; preview: HaulLog }) {
  const points = logs.length > 0 ? logs : [preview];
  const values = points.map((entry) => entry.efficiencyTonneKmPerL);
  const minimum = Math.max(0, Math.min(...values) * 0.82);
  const maximum = Math.max(minimum + 1, Math.max(...values) * 1.12);
  const left = 56;
  const right = 744;
  const top = 24;
  const bottom = 218;
  const x = (index: number) => points.length === 1 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left);
  const y = (value: number) => bottom - ((value - minimum) / (maximum - minimum)) * (bottom - top);
  const path = points.map((entry, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(entry.efficiencyTonneKmPerL)}`).join(" ");
  const area = points.length > 1 ? `${path} L ${right} ${bottom} L ${left} ${bottom} Z` : "";

  return <div className="efficiency-chart-wrap">
    <svg className="efficiency-chart" viewBox="0 0 780 260" role="img" aria-labelledby="haul-chart-title haul-chart-description">
      <title id="haul-chart-title">Haul efficiency history</title>
      <desc id="haul-chart-description">Estimated tonne-kilometres moved per litre for the selected vehicle.</desc>
      {[0, 1, 2, 3].map((step) => {
        const value = maximum - ((maximum - minimum) * step) / 3;
        const rowY = y(value);
        return <g key={step}>
          <line className="efficiency-grid-line" x1={left} x2={right} y1={rowY} y2={rowY} />
          <text className="efficiency-axis-label" x={left - 12} y={rowY + 4} textAnchor="end">{metric(value, 0)}</text>
        </g>;
      })}
      {area && <path className="efficiency-area" d={area} />}
      {points.length > 1 && <path className="efficiency-line" d={path} />}
      {points.map((entry, index) => <g key={entry.id}>
        <circle className={`efficiency-point efficiency-point-${entry.vehicleId.toLowerCase()}`} cx={x(index)} cy={y(entry.efficiencyTonneKmPerL)} r="5">
          <title>{`${entry.vehicleId}: ${metric(entry.efficiencyTonneKmPerL)} t·km/L`}</title>
        </circle>
        {(index === 0 || index === points.length - 1) && <text className="efficiency-run-label" x={x(index)} y={242} textAnchor="middle">
          {logs.length > 0 ? `Run ${String(index + 1).padStart(2, "0")}` : "Current estimate"}
        </text>}
      </g>)}
    </svg>
    {logs.length === 0 && <p className="efficiency-chart-empty">Log an estimate to begin the haul record.</p>}
  </div>;
}

export function HaulEfficiencyPanel() {
  const [inputs, setInputs] = useState<HaulInputs>(DEFAULT_INPUTS);
  const [logs, setLogs] = useState<HaulLog[]>(readLogs);
  const calculation = useMemo(() => calculate(inputs), [inputs]);
  const selectedLogs = logs.filter((entry) => entry.vehicleId === inputs.vehicleId).slice(-12);
  const valid = inputs.payloadT > 0 && inputs.cycleDistanceKm > 0 && inputs.mileageKmPerL > 0 && inputs.cycleMinutes > 0;
  const preview: HaulLog = { ...inputs, ...calculation, id: "preview", loggedAt: Date.now() };

  const updateNumber = (field: keyof Omit<HaulInputs, "vehicleId">, value: string) => {
    setInputs((current) => ({ ...current, [field]: Number(value) }));
  };

  const logEstimate = () => {
    if (!valid) return;
    const entry: HaulLog = { ...inputs, ...calculation, id: `${Date.now()}-${inputs.vehicleId}`, loggedAt: Date.now() };
    setLogs((current) => {
      const next = [...current, entry].slice(-MAX_LOGS);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return <div className="supervisor-section efficiency-workspace">
    <article className="supervisor-panel efficiency-panel">
      <header className="supervisor-panel-heading efficiency-heading">
        <div>
          <p className="eyebrow">Estimated performance</p>
          <h3>Haul efficiency</h3>
        </div>
        <span className="efficiency-source"><i aria-hidden="true" />Manual inputs</span>
      </header>

      <div className="efficiency-metric-strip">
        <div><span>Transport efficiency</span><strong>{valid ? metric(calculation.efficiencyTonneKmPerL) : "--"}</strong><small>t·km/L</small></div>
        <div><span>Fuel per cycle</span><strong>{valid ? metric(calculation.fuelPerCycleL, 2) : "--"}</strong><small>litres estimated</small></div>
        <div><span>Payload rate</span><strong>{valid ? metric(calculation.throughputTph) : "--"}</strong><small>tonnes/hour</small></div>
        <div><span>Recorded cycles</span><strong>{selectedLogs.length}</strong><small>{inputs.vehicleId.replace("DUMPER_0", "Truck ")}</small></div>
      </div>

      <div className="efficiency-body">
        <div className="efficiency-plot-panel">
          <div className="efficiency-plot-title">
            <div><strong>{inputs.vehicleId.replace("DUMPER_0", "Truck ")}</strong><span>Efficiency by logged cycle</span></div>
            <span>t·km/L</span>
          </div>
          <EfficiencyGraph logs={selectedLogs} preview={preview} />
        </div>

        <form className="efficiency-input-panel" onSubmit={(event) => { event.preventDefault(); logEstimate(); }}>
          <label>
            <span>Vehicle</span>
            <select value={inputs.vehicleId} onChange={(event) => setInputs((current) => ({ ...current, vehicleId: event.target.value as VehicleId }))}>
              <option value="DUMPER_01">Truck 1</option>
              <option value="DUMPER_02">Truck 2</option>
            </select>
          </label>
          <label><span>Payload per cycle</span><div><input type="number" min="0.1" step="0.1" value={inputs.payloadT} onChange={(event) => updateNumber("payloadT", event.target.value)} /><small>t</small></div></label>
          <label><span>Cycle distance</span><div><input type="number" min="0.1" step="0.1" value={inputs.cycleDistanceKm} onChange={(event) => updateNumber("cycleDistanceKm", event.target.value)} /><small>km</small></div></label>
          <label><span>Average mileage</span><div><input type="number" min="0.1" step="0.1" value={inputs.mileageKmPerL} onChange={(event) => updateNumber("mileageKmPerL", event.target.value)} /><small>km/L</small></div></label>
          <label><span>Cycle time</span><div><input type="number" min="1" step="1" value={inputs.cycleMinutes} onChange={(event) => updateNumber("cycleMinutes", event.target.value)} /><small>min</small></div></label>
          <p>Fuel use is estimated from entered mileage until a fuel sensor is connected.</p>
          <button type="submit" disabled={!valid}>Log estimate</button>
        </form>
      </div>
    </article>

    <article className="supervisor-panel efficiency-ledger-panel">
      <header className="supervisor-panel-heading">
        <div><p className="eyebrow">Cycle record</p><h3>Recent estimates</h3></div>
        <span className="panel-context-label">Saved on this device</span>
      </header>
      {logs.length === 0 ? <div className="supervisor-empty-state compact"><strong>No haul estimates logged</strong><p>Enter a cycle above to start the record.</p></div>
        : <div className="efficiency-ledger">
          {[...logs].reverse().slice(0, 8).map((entry) => <div key={entry.id}>
            <span><strong>{entry.vehicleId.replace("DUMPER_0", "Truck ")}</strong><small>{new Date(entry.loggedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span>
            <span><small>Payload</small><strong>{metric(entry.payloadT)} t</strong></span>
            <span><small>Mileage</small><strong>{metric(entry.mileageKmPerL)} km/L</strong></span>
            <span><small>Efficiency</small><strong>{metric(entry.efficiencyTonneKmPerL)} t·km/L</strong></span>
          </div>)}
        </div>}
    </article>
  </div>;
}
