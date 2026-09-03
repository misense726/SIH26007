import { useEffect, useState } from "react";
import { LoginPage } from "./auth/LoginPage";
import {
  clearRole,
  readInitialRole,
  saveRole,
  type DashboardRole,
} from "./auth/roleSession";
import { DashboardErrorBoundary } from "./components/DashboardErrorBoundary";
import type { AwarenessMode } from "./driver/driverAwareness";
import { AppShell } from "./layout/AppShell";
import { DashboardViewRouter } from "./layout/DashboardViewRouter";
import { resolveDashboardRoute } from "./layout/dashboardViews";
import { useDashboardNavigation } from "./layout/useDashboardNavigation";
import { useSensorSettings } from "./settings/useSensorSettings";
import { SimulationControls } from "./simulation/SimulationControls";
import { useTelemetry } from "./state/useTelemetry";
import { applyTheme, readInitialTheme, saveTheme, type Theme } from "./theme";
import "./styles.css";

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
  const { world, connection } = useTelemetry();
  const sensorSettings = useSensorSettings();
  const { view, navigate } = useDashboardNavigation(role);
  const [awarenessMode, setAwarenessMode] = useState<AwarenessMode>("AUTO");

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
    >
      <DashboardErrorBoundary resetKey={view}>
        {connection === "CONNECTED" && world.mode === "SIMULATED" && view !== "SETTINGS" && (
          <SimulationControls simulation={world.simulation} />
        )}

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
    if (role === null) {
      document.title = "FogSen | Choose console";
    }
  }, [role]);

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    saveTheme(nextTheme);
  }

  function selectRole(nextRole: DashboardRole) {
    saveRole(nextRole);
    window.history.replaceState(null, "", resolveDashboardRoute(nextRole, "").hash);
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
