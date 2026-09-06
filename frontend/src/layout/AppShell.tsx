import type { ReactNode } from "react";
import { ConnectionPill, ModePill } from "../components/StatusPill";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ConnectionState } from "../state/useTelemetry";
import type { DataMode } from "../types";
import type { Theme } from "../theme";
import { dashboardViews, type DashboardView, type DashboardWorkspace } from "./dashboardViews";

interface AppShellProps {
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  connection: ConnectionState;
  mode: DataMode | null;
  children: ReactNode;
}

function DashboardViewIcon({ view }: { view: DashboardView }) {
  if (view === "DRIVER") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16.5V9.8c0-.8.4-1.5 1.1-1.9L8 6.2h8l2.9 1.7c.7.4 1.1 1.1 1.1 1.9v6.7" />
        <path d="M6 13h12M7.5 16.5h.01M16.5 16.5h.01M7 6.2l1.2-2.2h7.6L17 6.2M5 19h3v-2.5M19 19h-3v-2.5" />
      </svg>
    );
  }
  if (view === "SPATIAL") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="2.3" />
        <circle cx="12" cy="12" r="6" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      </svg>
    );
  }
  if (view === "SUPERVISOR") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="8" height="6" rx="1.5" />
        <rect x="13" y="13" width="8" height="6" rx="1.5" />
        <path d="M11 8h3a3 3 0 0 1 3 3v2M7 11v3a3 3 0 0 0 3 3h3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  );
}

function WorkspaceLinks({
  workspace,
  view,
  onViewChange,
}: {
  workspace: DashboardWorkspace;
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
}) {
  const workspaceViews = dashboardViews.filter((candidate) => candidate.workspace === workspace);
  return (
    <div className={`workspace-nav-group workspace-nav-${workspace.toLowerCase()}`}>
      <span className="workspace-nav-label">{workspace === "DRIVER" ? "Driver workspace" : "Supervisor workspace"}</span>
      <div className="workspace-nav-links">
        {workspaceViews.map((dashboardView) => (
          <a
            key={dashboardView.value}
            href={dashboardView.hash}
            className={view === dashboardView.value ? "active" : ""}
            aria-current={view === dashboardView.value ? "page" : undefined}
            title={dashboardView.description}
            onClick={(event) => {
              event.preventDefault();
              onViewChange(dashboardView.value);
            }}
          >
            <DashboardViewIcon view={dashboardView.value} />
            <span>{dashboardView.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function AppShell({
  view,
  onViewChange,
  theme,
  onThemeChange,
  connection,
  mode,
  children,
}: AppShellProps) {
  const supervisorWorkspace = view === "SUPERVISOR";
  const homeView: DashboardView = supervisorWorkspace ? "SUPERVISOR" : "DRIVER";

  return (
    <main className={`app-shell app-shell-${supervisorWorkspace ? "supervisor" : "driver"}`}>
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
          href={supervisorWorkspace ? "#fleet" : "#driver"}
          aria-label={`FogSen ${supervisorWorkspace ? "supervisor" : "driver"} workspace home`}
          onClick={(event) => {
            event.preventDefault();
            onViewChange(homeView);
          }}
        >
          <span className="brand-mark" aria-hidden="true"><span>FS</span></span>
          <div>
            <p className="eyebrow">{supervisorWorkspace ? "Supervisor console" : "Driver console"}</p>
            <h1>FogSen</h1>
          </div>
        </a>

        <nav className="view-switcher" aria-label="Primary navigation">
          <WorkspaceLinks workspace="DRIVER" view={view} onViewChange={onViewChange} />
          <span className="workspace-divider" aria-hidden="true" />
          <WorkspaceLinks workspace="SUPERVISOR" view={view} onViewChange={onViewChange} />
        </nav>

        <div className="status-row" aria-label="System status">
          <ConnectionPill state={connection} />
          {connection === "CONNECTED" && mode && <ModePill mode={mode} />}
          <ThemeToggle theme={theme} onChange={onThemeChange} />
        </div>
      </header>

      <div id="dashboard-content" className="dashboard-content" tabIndex={-1}>
        {children}
      </div>
    </main>
  );
}
