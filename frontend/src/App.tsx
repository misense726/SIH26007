import { useEffect, useState } from "react";
import type { AwarenessMode } from "./driver/driverAwareness";
import { useSensorSettings } from "./settings/useSensorSettings";
import { AppShell } from "./layout/AppShell";
import { DashboardViewRouter } from "./layout/DashboardViewRouter";
import { useDashboardNavigation } from "./layout/useDashboardNavigation";
import { DashboardErrorBoundary } from "./components/DashboardErrorBoundary";
import { SimulationControls } from "./simulation/SimulationControls";
import { useTelemetry } from "./state/useTelemetry";
import { applyTheme, readInitialTheme, saveTheme, type Theme } from "./theme";
import "./styles.css";
import "./layout/appShell.css";
import "./supervisor/supervisor.css";

export default function App() {
  const { world, connection } = useTelemetry();
  const sensorSettings = useSensorSettings();
  const { view, navigate } = useDashboardNavigation();
  const [awarenessMode, setAwarenessMode] = useState<AwarenessMode>("AUTO");
  const [theme, setTheme] = useState<Theme>(() => {
    const initialTheme = readInitialTheme();
    applyTheme(initialTheme);
    return initialTheme;
  });

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    if (connection === "CONNECTED" && world.mode === "SIMULATED" && !window.location.hash) {
      navigate("SPATIAL");
    }
  }, [connection, world.mode, navigate]);

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    saveTheme(nextTheme);
  }

  return (
    <AppShell
      view={view}
      onViewChange={navigate}
      theme={theme}
      onThemeChange={changeTheme}
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
