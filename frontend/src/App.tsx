import { useEffect, useState } from "react";
import { ConnectionPill, ModePill } from "./components/StatusPill";
import { ThemeToggle } from "./components/ThemeToggle";
import { DriverDashboard } from "./driver/DriverDashboard";
import type { AwarenessMode } from "./driver/driverAwareness";
import { SensorSettingsPage } from "./settings/SensorSettingsPage";
import { useSensorSettings } from "./settings/useSensorSettings";
import { SimulationControls } from "./simulation/SimulationControls";
import { SpatialDashboard } from "./spatial/SpatialDashboard";
import { useTelemetry } from "./state/useTelemetry";
import { SupervisorDashboard } from "./supervisor/SupervisorDashboard";
import { applyTheme, readInitialTheme, saveTheme, type Theme } from "./theme";
import "./styles.css";

type DashboardView = "DRIVER" | "SPATIAL" | "SUPERVISOR" | "SETTINGS";

const dashboardViews: Array<{ value: DashboardView; label: string }> = [
  { value: "DRIVER", label: "Driver" },
  { value: "SPATIAL", label: "Spatial view" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "SETTINGS", label: "Settings" },
];

export default function App() {
  const { world, connection } = useTelemetry();
  const sensorSettings = useSensorSettings();
  const [view, setView] = useState<DashboardView>("DRIVER");
  const [awarenessMode, setAwarenessMode] = useState<AwarenessMode>("AUTO");
  const [theme, setTheme] = useState<Theme>(() => {
    const initialTheme = readInitialTheme();
    applyTheme(initialTheme);
    return initialTheme;
  });

  useEffect(() => applyTheme(theme), [theme]);

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    saveTheme(nextTheme);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">FS</span>
          <div>
            <p className="eyebrow">Mine vehicle awareness</p>
            <h1>FogSen</h1>
          </div>
        </div>

        <nav className="view-switcher" aria-label="Dashboard view">
          {dashboardViews.map((dashboardView) => (
            <button
              key={dashboardView.value}
              type="button"
              className={view === dashboardView.value ? "active" : ""}
              aria-pressed={view === dashboardView.value}
              onClick={() => setView(dashboardView.value)}
            >
              {dashboardView.label}
            </button>
          ))}
        </nav>

        <div className="status-row">
          <ThemeToggle theme={theme} onChange={changeTheme} />
          <ConnectionPill state={connection} />
          {connection === "CONNECTED" && <ModePill mode={world.mode} />}
        </div>
      </header>

      {connection === "CONNECTED" && world.mode === "SIMULATED" && view !== "SETTINGS" && (
        <SimulationControls simulation={world.simulation} />
      )}

      {view === "DRIVER" && (
        <DriverDashboard
          world={world}
          awarenessMode={awarenessMode}
          onAwarenessModeChange={setAwarenessMode}
          connection={connection}
          sensorSettings={sensorSettings.settings.sensors}
        />
      )}
      {view === "SPATIAL" && (
        <SpatialDashboard
          world={world}
          connection={connection}
          sensorSettings={sensorSettings.settings.sensors}
        />
      )}
      {view === "SUPERVISOR" && (
        <SupervisorDashboard world={world} connection={connection} />
      )}
      {view === "SETTINGS" && (
        <SensorSettingsPage
          world={world}
          telemetryConnection={connection}
          settings={sensorSettings.settings}
          settingsConnection={sensorSettings.connection}
          message={sensorSettings.message}
          onSensorChange={sensorSettings.updateSensor}
          onSensorSave={sensorSettings.saveSensor}
          onZeroImu={sensorSettings.zeroImuNow}
        />
      )}

      <footer>
        2D/2.5D ToF awareness. Relative altitude is approximate. Motor cut is an automatic
        emergency stop simulation.
      </footer>
    </main>
  );
}
