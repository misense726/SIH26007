import type { WorldState } from "../types";

export function VehicleSensors({ world }: { world: WorldState }) {
  if (world.mode !== "LIVE") return null;
  return <section className="supervisor-panel" aria-label="Truck GPS and load">
    <header className="supervisor-panel-heading"><h3>Truck GPS and load</h3><span>LIVE</span></header>
    <div className="primary-summary-grid">
      {(["DUMPER_01", "DUMPER_02"] as const).map((id, index) => {
        const sample = world.vehicle_telemetry?.find((item) => item.vehicle_id === id);
        const online = sample?.online ?? false;
        const gps = sample?.gps;
        const load = sample?.load;
        const receivingGps = online && (gps?.bytes ?? 0) > 0;
        const coordinates = receivingGps && gps?.fix && gps.lat !== null && gps.lon !== null
          ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : null;
        return <div key={id}>
          <strong>Truck {index + 1}</strong>
          <span>{online ? "Connected" : "Offline"}</span>
          <span>{coordinates ?? "No GPS fix"}</span>
          <small>{!online ? "Waiting for telemetry"
            : !receivingGps ? "GPS data not detected"
            : coordinates ? `${gps?.sats ?? 0} satellites · HDOP ${gps?.hdop?.toFixed(1) ?? "unknown"}`
            : `Receiving GPS · ${gps?.sats ?? 0} satellites`}</small>
          {coordinates && <small>Speed {gps?.speed_mps?.toFixed(2) ?? "unknown"} m/s · Fix age {gps?.age ?? 0} ms</small>}
          {index === 0 && <span>Load: {!online || !load?.ready ? "Unavailable"
            : load.calibrated && load.kg !== null ? `${load.kg.toFixed(2)} kg`
            : load.taring ? "Taring unloaded platform"
            : load.tared ? "Tared, reference mass needed" : "Not tared"}</span>}
          {index === 0 && online && load?.ready && !load.calibrated && <small>Net scale reading: {load.net_raw ?? "--"}</small>}
        </div>;
      })}
    </div>
  </section>;
}
