import { useEffect, useState } from "react";
import type { AwarenessMode } from "./driver/driverAwareness";
import { useSensorSettings } from "./settings/useSensorSettings";
import { AppShell } from "./layout/AppShell";
import { DashboardViewRouter } from "./layout/DashboardViewRouter";
import { useDashboardNavigation } from "./layout/useDashboardNavigation";
import { DashboardErrorBoundary } from "./components/DashboardErrorBoundary";
import { useTelemetry } from "./state/useTelemetry";
import { STATIC_DEMO } from "./simulation/demoMode";
import { applyTheme, readInitialTheme, saveTheme, type Theme } from "./theme";
import "./styles.css";
import "./layout/appShell.css";
import "./supervisor/supervisor.css";

export default function App() {
  const { world, connection, demoStatus, paused, togglePaused } = useTelemetry();
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
        ) : <DashboardViewRouter
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
        />}
      </DashboardErrorBoundary>
    </AppShell>
  );
}
