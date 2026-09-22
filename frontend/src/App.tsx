import { useEffect, useState } from "react";
import { LoginPage } from "./auth/LoginPage";
import {
  clearRole,
  readInitialRole,
  saveRole,
  type DashboardRole,
} from "./auth/roleSession";
import { DashboardErrorBoundary } from "./components/DashboardErrorBoundary";
import {
  DEFAULT_AWARENESS_MODE,
  type AwarenessMode,
} from "./driver/driverAwareness";
import { AppShell } from "./layout/AppShell";
import { DashboardViewRouter } from "./layout/DashboardViewRouter";
import { dashboardRoleFromHash, resolveDashboardRoute } from "./layout/dashboardViews";
import { useDashboardNavigation } from "./layout/useDashboardNavigation";
import { useSensorSettings } from "./settings/useSensorSettings";
import { STATIC_DEMO } from "./simulation/demoMode";
import { useTelemetry } from "./state/useTelemetry";
import { applyTheme, readInitialTheme, saveTheme, type Theme } from "./theme";
import "./styles.css";
import "./layout/appShell.css";
import "./supervisor/supervisor.css";

interface AuthenticatedDashboardProps {
  role: DashboardRole;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onLogout: () => void;
}

function AuthenticatedDashboard({
  role,
  theme,
  onThemeChange,
  onLogout,
}: AuthenticatedDashboardProps) {
  const { world, connection, demoStatus, paused, togglePaused } = useTelemetry();
  const sensorSettings = useSensorSettings();
  const { view, navigate } = useDashboardNavigation(role);
  const [awarenessMode, setAwarenessMode] = useState<AwarenessMode>(DEFAULT_AWARENESS_MODE);

  return (
    <AppShell
      role={role}
      view={view}
      onViewChange={navigate}
      onLogout={onLogout}
      theme={theme}
      onThemeChange={onThemeChange}
      connection={connection}
      mode={world.mode}
      demoStatus={demoStatus}
      demoPaused={paused}
      onDemoPause={togglePaused}
    >
      <DashboardErrorBoundary resetKey={view}>
        {STATIC_DEMO && world.sequence === 0 ? (
          <section className="demo-loading" role="status">
            <h2>{demoStatus === "Buffering demo" ? "Demo download interrupted" : "Loading the mine simulation"}</h2>
            <p>{demoStatus === "Buffering demo"
              ? "The download will retry automatically. No live hardware connection is needed."
              : "Loading the first part of the recorded simulation. Playback pauses when this tab is hidden."}</p>
          </section>
        ) : null}

        {!(STATIC_DEMO && world.sequence === 0) && (
          <DashboardViewRouter
            view={view}
            world={world}
            connection={connection}
            awarenessMode={awarenessMode}
            onAwarenessModeChange={setAwarenessMode}
            sensorSettings={sensorSettings.settings}
            settingsConnection={sensorSettings.connection}
            settingsMessage={sensorSettings.message}
            onSensorChange={sensorSettings.updateSensor}
            onSensorSave={sensorSettings.saveSensor}
            onZeroImu={sensorSettings.zeroImuNow}
          />
        )}
      </DashboardErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  const [role, setRole] = useState<DashboardRole | null>(readInitialRole);
  const [theme, setTheme] = useState<Theme>(() => {
    const initialTheme = readInitialTheme();
    applyTheme(initialTheme);
    return initialTheme;
  });

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    const syncRoleFromLocation = () => {
      const linkedRole = dashboardRoleFromHash(window.location.hash);
      if (linkedRole && linkedRole !== role) {
        saveRole(linkedRole);
        setRole(linkedRole);
      }
    };

    window.addEventListener("hashchange", syncRoleFromLocation);
    window.addEventListener("popstate", syncRoleFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncRoleFromLocation);
      window.removeEventListener("popstate", syncRoleFromLocation);
    };
  }, [role]);

  useEffect(() => {
    if (role === null) {
      document.title = "MI Sense | Choose console";
    }
  }, [role]);

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    saveTheme(nextTheme);
  }

  function selectRole(nextRole: DashboardRole) {
    saveRole(nextRole);
    const initialDestination = STATIC_DEMO && nextRole === "DRIVER" ? "SPATIAL" : "";
    window.history.replaceState(null, "", resolveDashboardRoute(nextRole, initialDestination).hash);
    setRole(nextRole);
  }

  function logout() {
    clearRole();
    const neutralLocation = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", neutralLocation);
    setRole(null);
  }

  if (role === null) {
    return (
      <LoginPage
        theme={theme}
        onThemeChange={changeTheme}
        onSelectRole={selectRole}
      />
    );
  }

  return (
    <AuthenticatedDashboard
      role={role}
      theme={theme}
      onThemeChange={changeTheme}
      onLogout={logout}
    />
  );
}
