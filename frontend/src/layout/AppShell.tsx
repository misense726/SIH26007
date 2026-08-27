import type { ReactNode } from "react";
import { ConnectionPill, ModePill } from "../components/StatusPill";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ConnectionState } from "../state/useTelemetry";
import type { DataMode } from "../types";
import type { Theme } from "../theme";
import { dashboardViews, type DashboardView } from "./dashboardViews";

interface AppShellProps {
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  connection: ConnectionState;
  mode: DataMode | null;
  children: ReactNode;
}

/** Stable application chrome. Domain views can change without touching navigation. */
export function AppShell({
  view,
  onViewChange,
  theme,
  onThemeChange,
  connection,
  mode,
  children,
}: AppShellProps) {
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
              onClick={() => onViewChange(dashboardView.value)}
            >
              {dashboardView.label}
            </button>
          ))}
        </nav>

        <div className="status-row">
          <ThemeToggle theme={theme} onChange={onThemeChange} />
          <ConnectionPill state={connection} />
          {connection === "CONNECTED" && mode && <ModePill mode={mode} />}
        </div>
      </header>

      {children}

      <footer>
        2D/2.5D ToF awareness. Relative altitude is approximate. Motor cut is an automatic
        emergency stop simulation.
      </footer>
    </main>
  );
}
