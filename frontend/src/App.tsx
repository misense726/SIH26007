import { useState } from "react";
import { ConnectionPill, ModePill } from "./components/StatusPill";
import { DriverDashboard } from "./driver/DriverDashboard";
import { useTelemetry } from "./state/useTelemetry";
import { SupervisorDashboard } from "./supervisor/SupervisorDashboard";
import "./styles.css";

type DashboardView = "DRIVER" | "SUPERVISOR";

export default function App() {
  const { world, connection } = useTelemetry();
  const [view, setView] = useState<DashboardView>("DRIVER");

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
          <ConnectionPill state={connection} />
          <ModePill mode={world.mode} />
        </div>
      </header>

      {view === "DRIVER" ? (
        <DriverDashboard world={world} />
      ) : (
        <SupervisorDashboard world={world} />
      )}

      <footer>
        2D/2.5D ToF awareness. Relative altitude is approximate. Motor cut is an automatic
        emergency stop simulation.
      </footer>
    </main>
  );
}
