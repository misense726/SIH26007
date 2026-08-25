import { useEffect, useState } from "react";
import { ConnectionPill, ModePill } from "./components/StatusPill";
import { ThemeToggle } from "./components/ThemeToggle";
import { DriverDashboard } from "./driver/DriverDashboard";
import type { AwarenessMode } from "./driver/driverAwareness";
import { SimulationControls } from "./simulation/SimulationControls";
import { useTelemetry } from "./state/useTelemetry";
import { SupervisorDashboard } from "./supervisor/SupervisorDashboard";
import { applyTheme, readInitialTheme, saveTheme, type Theme } from "./theme";
import "./styles.css";

type DashboardView = "DRIVER" | "SUPERVISOR";

export default function App() {
  const { world, connection } = useTelemetry();
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
          <button
            type="button"
            className={view === "DRIVER" ? "active" : ""}
            aria-pressed={view === "DRIVER"}
            onClick={() => setView("DRIVER")}
          >
            Driver
          </button>
          <button
            type="button"
            className={view === "SUPERVISOR" ? "active" : ""}
            aria-pressed={view === "SUPERVISOR"}
            onClick={() => setView("SUPERVISOR")}
          >
            Supervisor
          </button>
        </nav>

        <div className="status-row">
          <ThemeToggle theme={theme} onChange={changeTheme} />
          <ConnectionPill state={connection} />
          {connection === "CONNECTED" && <ModePill mode={world.mode} />}
        </div>
      </header>

      {connection === "CONNECTED" && world.mode === "SIMULATED" && (
        <SimulationControls simulation={world.simulation} />
      )}

      {view === "DRIVER" ? (
        <DriverDashboard
          world={world}
          awarenessMode={awarenessMode}
          onAwarenessModeChange={setAwarenessMode}
          connection={connection}
        />
      ) : (
        <SupervisorDashboard world={world} connection={connection} />
      )}

      <footer>
        2D/2.5D ToF awareness. Relative altitude is approximate. Motor cut is an automatic
        emergency stop simulation.
      </footer>
    </main>
  );
}
