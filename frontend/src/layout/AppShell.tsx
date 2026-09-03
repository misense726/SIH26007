import type { ReactNode } from "react";
import type { DashboardRole } from "../auth/roleSession";
import { ConnectionPill, ModePill } from "../components/StatusPill";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ConnectionState } from "../state/useTelemetry";
import type { Theme } from "../theme";
import type { DataMode } from "../types";
import { DashboardViewIcon } from "./DashboardViewIcon";
import {
  dashboardRoleLabel,
  dashboardViewHash,
  dashboardViewsForRole,
  defaultDashboardView,
  type DashboardView,
} from "./dashboardViews";

interface AppShellProps {
  role: DashboardRole;
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  onLogout: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  connection: ConnectionState;
  mode: DataMode | null;
  children: ReactNode;
}

export function AppShell({
  role,
  view,
  onViewChange,
  onLogout,
  theme,
  onThemeChange,
  connection,
  mode,
  children,
}: AppShellProps) {
  const homeView = defaultDashboardView(role);
  const availableViews = dashboardViewsForRole(role);
  const roleLabel = dashboardRoleLabel(role);

  return (
    <main className="app-shell">
      <a
        className="skip-link"
        href="#dashboard-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("dashboard-content")?.focus();
        }}
      >
        Skip to dashboard
      </a>
      <header className="topbar">
        <a
          className="brand-lockup"
          href={dashboardViewHash(homeView)}
          aria-label={`FogSen ${roleLabel.toLowerCase()} home`}
          onClick={(event) => {
            event.preventDefault();
            onViewChange(homeView);
          }}
        >
          <span className="brand-mark" aria-hidden="true">FS</span>
          <div>
            <p className="eyebrow">{roleLabel} console</p>
            <h1>FogSen</h1>
          </div>
        </a>

        {availableViews.length > 1 && (
          <nav className="view-switcher" aria-label="Primary navigation">
            {availableViews.map((dashboardView) => (
              <a
                key={dashboardView.value}
                href={dashboardView.hash}
                className={view === dashboardView.value ? "active" : ""}
                aria-current={view === dashboardView.value ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onViewChange(dashboardView.value);
                }}
              >
                <DashboardViewIcon view={dashboardView.value} />
                <span>{dashboardView.label}</span>
              </a>
            ))}
          </nav>
        )}

        <div className="status-row" aria-label="System status and session">
          <span className="role-chip">{roleLabel}</span>
          <ConnectionPill state={connection} />
          {connection === "CONNECTED" && mode && <ModePill mode={mode} />}
          <ThemeToggle theme={theme} onChange={onThemeChange} />
          <button
            type="button"
            className="logout-button"
            aria-label="Exit console"
            title="Exit console"
            onClick={onLogout}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5H5v14h4M14 8l4 4-4 4M8 12h10" />
            </svg>
            <span>Exit console</span>
          </button>
        </div>
      </header>

      <div id="dashboard-content" className="dashboard-content" tabIndex={-1}>
        {children}
      </div>
    </main>
  );
}
