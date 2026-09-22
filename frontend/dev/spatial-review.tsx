// Development-only visual fixture. Vite's production entry does not include it.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SpatialDashboard } from "../src/spatial/SpatialDashboard";
import { defaultSensorSettings } from "../src/settings/sensorSettingsApi";
import { defaultWorldState } from "../src/state/defaultState";
import type { DataMode, WorldState } from "../src/types";
import "../src/styles.css";

const sensors = defaultSensorSettings().sensors;
function fixture(mode: DataMode, state: string): WorldState {
  const world: WorldState = structuredClone(defaultWorldState);
  world.mode = mode;
  world.generated_at_ms = 10_000;
  world.vehicles[0] = { ...world.vehicles[0], x_m: 10, y_m: 20, heading_deg: 90, mode };
  world.motion = { ...world.motion, imu_heading_deg: 130, imu_yaw_rate_dps: 24, mode };
  world.sensor_health = sensors.map((s) => ({ sensor_id: s.sensor_id,
    status: state === "Stale" ? "STALE" : "HEALTHY", last_update_ms: 10_000, confidence: 1, detail: null }));
  const worldPoint = (x: number, y: number) => ({ x_m: 10 + y, y_m: 20 - x });
  for (const sensor of sensors) {
    const mount = sensor.display_pose;
    const latestAngle = sensor.scanner ? 25 : 0;
    const range = sensor.scanner ? 1.4 / Math.cos(latestAngle * Math.PI / 180)
      : sensor.sensor_id === "front_fixed" ? 1.2 : 0.8;
    world.ranges.push({ sensor_id: sensor.sensor_id, range_m: state === "No return" ? sensor.visual_range_m : range,
      angle_deg: latestAngle, is_valid: true, max_range_m: sensor.visual_range_m, quality: 1, timestamp_ms: 10_000, mode });
    if (state === "No return") continue;
    for (let i = 0; i < (sensor.scanner ? 100 : 240); i++) {
      const angle = sensor.scanner ? -68 + i * 1.2 : 0;
      const yaw = (mount.yaw_deg + angle) * Math.PI / 180;
      const distance = sensor.scanner ? 1.4 / Math.cos(angle * Math.PI / 180) : range;
      const local = { x: mount.x_m + Math.sin(yaw) * distance, y: mount.y_m + Math.cos(yaw) * distance };
      world.spatial_points.push({ ...worldPoint(local.x, local.y), source_sensor_id: sensor.sensor_id,
        timestamp_ms: 5000 + i * (sensor.scanner ? 50 : 20), height_hint_m: 0.8, quality: 1 });
    }
  }
  return world;
}

function Review() {
  const [mode, setMode] = useState<DataMode>("LIVE");
  const [state, setState] = useState("Dense returns");
  const [offline, setOffline] = useState(false);
  return <main style={{ maxWidth: 1520, margin: "0 auto", padding: 20 }}>
    <nav aria-label="Fixture controls" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
      <strong>Controlled telemetry fixture</strong>
      <label>Mode <select aria-label="Fixture mode" value={mode} onChange={(e) => setMode(e.target.value as DataMode)}>
        <option>LIVE</option><option>SIMULATED</option><option>REPLAY</option>
      </select></label>
      <label>Returns <select aria-label="Fixture returns" value={state} onChange={(e) => setState(e.target.value)}>
        <option>Dense returns</option><option>No return</option><option>Stale</option>
      </select></label>
      <button onClick={() => setOffline(!offline)}>{offline ? "Reconnect" : "Disconnect"}</button>
      <button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light"; }}>Toggle theme</button>
    </nav>
    <SpatialDashboard world={fixture(mode, state)} connection={offline ? "DISCONNECTED" : "CONNECTED"} sensorSettings={sensors} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Review />);
