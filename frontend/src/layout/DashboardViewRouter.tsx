import { DriverDashboard } from "../driver/DriverDashboard";
import type { AwarenessMode } from "../driver/driverAwareness";
import { SensorSettingsPage } from "../settings/SensorSettingsPage";
import {
  type SensorDisplaySetting,
  type SensorId,
  type SensorSettingsState,
} from "../settings/sensorSettingsApi";
import type { SettingsConnection } from "../settings/useSensorSettings";
import { SpatialDashboard } from "../spatial/SpatialDashboard";
import type { ConnectionState } from "../state/useTelemetry";
import { SupervisorDashboard } from "../supervisor/SupervisorDashboard";
import type { WorldState } from "../types";
import type { DashboardView } from "./dashboardViews";

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
  if (view === "DRIVER") {
    return (
      <DriverDashboard
        world={world}
        awarenessMode={awarenessMode}
        onAwarenessModeChange={onAwarenessModeChange}
        connection={connection}
        sensorSettings={sensorSettings.sensors}
      />
    );
  }

  if (view === "SPATIAL") {
    return (
      <SpatialDashboard
        world={world}
        connection={connection}
        sensorSettings={sensorSettings.sensors}
      />
    );
  }

  if (view === "SUPERVISOR") {
    return <SupervisorDashboard world={world} connection={connection} />;
  }

  return (
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
