import { lazy, Suspense, type ReactNode } from "react";
import type { AwarenessMode } from "../driver/driverAwareness";
import {
  type SensorDisplaySetting,
  type SensorId,
  type SensorSettingsState,
} from "../settings/sensorSettingsApi";
import type { SettingsConnection } from "../settings/useSensorSettings";
import type { ConnectionState } from "../state/useTelemetry";
import type { WorldState } from "../types";
import type { DashboardView } from "./dashboardViews";

const DriverDashboard = lazy(async () => {
  const module = await import("../driver/DriverDashboard");
  return { default: module.DriverDashboard };
});

const SpatialDashboard = lazy(async () => {
  const module = await import("../spatial/SpatialDashboard");
  return { default: module.SpatialDashboard };
});

const SupervisorDashboard = lazy(async () => {
  const module = await import("../supervisor/SupervisorDashboard");
  return { default: module.SupervisorDashboard };
});

const SensorSettingsPage = lazy(async () => {
  const module = await import("../settings/SensorSettingsPage");
  return { default: module.SensorSettingsPage };
});

interface DashboardViewRouterProps {
  view: DashboardView;
  world: WorldState;
  connection: ConnectionState;
  awarenessMode: AwarenessMode;
  onAwarenessModeChange: (mode: AwarenessMode) => void;
  sensorSettings: SensorSettingsState;
  settingsConnection: SettingsConnection;
  settingsMessage: string | null;
  onSensorChange: (sensorId: SensorId, setting: SensorDisplaySetting) => void;
  onSensorSave: (sensorId: SensorId) => Promise<void>;
  onZeroImu: () => Promise<void>;
}

export function DashboardViewRouter({
  view,
  world,
  connection,
  awarenessMode,
  onAwarenessModeChange,
  sensorSettings,
  settingsConnection,
  settingsMessage,
  onSensorChange,
  onSensorSave,
  onZeroImu,
}: DashboardViewRouterProps) {
  let dashboard: ReactNode;

  if (view === "DRIVER") {
    dashboard = (
      <DriverDashboard
        world={world}
        awarenessMode={awarenessMode}
        onAwarenessModeChange={onAwarenessModeChange}
        connection={connection}
        sensorSettings={sensorSettings.sensors}
      />
    );
  } else if (view === "SPATIAL") {
    dashboard = (
      <SpatialDashboard
        world={world}
        connection={connection}
        sensorSettings={sensorSettings.sensors}
      />
    );
  } else if (view === "SUPERVISOR") {
    dashboard = <SupervisorDashboard world={world} connection={connection} />;
  } else {
    dashboard = (
      <SensorSettingsPage
        world={world}
        telemetryConnection={connection}
        settings={sensorSettings}
        settingsConnection={settingsConnection}
        message={settingsMessage}
        onSensorChange={onSensorChange}
        onSensorSave={onSensorSave}
        onZeroImu={onZeroImu}
      />
    );
  }

  return (
    <Suspense fallback={<div className="dashboard-loading" role="status">Loading console…</div>}>
      {dashboard}
    </Suspense>
  );
}
