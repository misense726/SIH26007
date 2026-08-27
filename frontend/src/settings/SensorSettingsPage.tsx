import type { FormEvent } from "react";
import type { WorldState } from "../types";
import type { ConnectionState } from "../state/useTelemetry";
import {
  type SensorDisplayPose,
  type SensorDisplaySetting,
  type SensorId,
  type SensorSettingsState,
} from "./sensorSettingsApi";
import type { SettingsConnection } from "./useSensorSettings";

interface SensorSettingsPageProps {
  world: WorldState;
  telemetryConnection: ConnectionState;
  settings: SensorSettingsState;
  settingsConnection: SettingsConnection;
  message: string | null;
  onSensorChange: (sensorId: SensorId, setting: SensorDisplaySetting) => void;
  onSensorSave: (sensorId: SensorId) => Promise<void>;
  onZeroImu: () => Promise<void>;
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}

function NumberField({ label, value, min, max, step, unit, onChange }: NumberFieldProps) {
  return (
    <label className="setting-field">
      <span>{label}</span>
      <span className="setting-input-wrap">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <small>{unit}</small>
      </span>
    </label>
  );
}

function SensorPlacementPreview({ sensors }: { sensors: SensorDisplaySetting[] }) {
  return (
    <svg className="sensor-placement-preview" viewBox="0 0 320 230" role="img" aria-label="Vehicle and configured sensor display positions">
      <defs>
        <pattern id="settings-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" className="settings-grid-line" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="318" height="228" rx="14" className="settings-preview-bg" />
      <rect x="1" y="1" width="318" height="228" rx="14" fill="url(#settings-grid)" />
      <path className="settings-vehicle" d="M135 165V70Q160 48 185 70V165Q160 184 135 165Z" />
      <path className="settings-vehicle-front" d="M150 61h20l-10-15z" />
      {sensors.map((sensor) => {
        const x = 160 + sensor.display_pose.x_m * 88;
        const y = 116 - sensor.display_pose.y_m * 88;
        const pitchRadians = (sensor.display_pose.pitch_deg * Math.PI) / 180;
        const length = Math.min(sensor.visual_range_m, 4) * 20 * Math.cos(pitchRadians);
        return (
          <g
            key={sensor.sensor_id}
            className={`settings-sensor-marker sensor-${sensor.sensor_id.replaceAll("_", "-")} ${sensor.display_pose.pitch_deg < -5 ? "settings-sensor-marker-down" : ""}`}
          >
            <line
              x1={x}
              y1={y}
              x2={x}
              y2={y - length}
              transform={`rotate(${sensor.display_pose.yaw_deg} ${x} ${y})`}
            />
            <circle cx={x} cy={y} r={sensor.scanner ? 6 : 4} />
            <title>
              {`${sensor.label}: ${sensor.display_pose.yaw_deg.toFixed(0)}° yaw, ${sensor.display_pose.pitch_deg.toFixed(0)}° pitch`}
            </title>
          </g>
        );
      })}
      <text x="160" y="18" textAnchor="middle" className="settings-preview-front">FRONT</text>
    </svg>
  );
}

function updatePose(
  setting: SensorDisplaySetting,
  field: keyof SensorDisplayPose,
  value: number,
): SensorDisplaySetting {
  return {
    ...setting,
    display_pose: { ...setting.display_pose, [field]: value },
  };
}

export function SensorSettingsPage({
  world,
  telemetryConnection,
  settings,
  settingsConnection,
  message,
  onSensorChange,
  onSensorSave,
  onZeroImu,
}: SensorSettingsPageProps) {
  const imuBusy = settings.imu_zero.status === "ZEROING";
  const telemetryLabel = telemetryConnection === "CONNECTED" ? world.mode : telemetryConnection;

  return (
    <section className="dashboard settings-page" aria-label="Sensor display settings">
      <header className="page-heading settings-heading">
        <div>
          <p className="eyebrow">Sensor setup</p>
          <h2>Display calibration</h2>
          <p>Place each ToF on the vehicle view and choose its display alert range.</p>
        </div>
        <span className="source-badge">{telemetryLabel}</span>
      </header>

      <div className="settings-overview-grid">
        <article className="settings-panel imu-zero-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Before mapping</p>
              <h3>Zero the IMU</h3>
            </div>
            <span className={`settings-status settings-status-${settings.imu_zero.status.toLowerCase()}`}>
              {settings.imu_zero.status}
            </span>
          </div>
          <p>Park the vehicle on level ground and keep it still while zeroing.</p>
          <button
            type="button"
            className="primary-action"
            disabled={!settings.imu_zero.available || imuBusy}
            onClick={() => void onZeroImu()}
          >
            {imuBusy ? "Zeroing..." : "Zero IMU"}
          </button>
          <small>{settings.imu_zero.detail ?? "No IMU status reported."}</small>
        </article>

        <article className="settings-panel placement-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live preview</p>
              <h3>Sensor placement</h3>
            </div>
            <span className="source-badge">Vehicle frame</span>
          </div>
          <SensorPlacementPreview sensors={settings.sensors} />
        </article>
      </div>

      <div className="settings-note" role="note">
        Display pose, visual range, and alert distance affect the dashboard only. MAIN keeps its own safety thresholds.
      </div>

      <div className="sensor-settings-list">
        {settings.sensors.map((sensor) => {
          const reading = world.ranges.find((item) => item.sensor_id === sensor.sensor_id);
          const health = world.sensor_health.find((item) => item.sensor_id === sensor.sensor_id);

          const changePose = (field: keyof SensorDisplayPose, value: number) =>
            onSensorChange(sensor.sensor_id, updatePose(sensor, field, value));
          const submit = (event: FormEvent) => {
            event.preventDefault();
            void onSensorSave(sensor.sensor_id);
          };

          return (
            <form className="sensor-setting-card" key={sensor.sensor_id} onSubmit={submit}>
              <header>
                <div>
                  <p className="eyebrow">{sensor.scanner ? "Sweep ToF" : "Fixed ToF"}</p>
                  <h3>{sensor.label}</h3>
                </div>
                <div className="sensor-live-summary">
                  <span className={`health-dot health-${health?.status.toLowerCase() ?? "offline"}`} />
                  <strong>{reading?.is_valid ? `${reading.range_m.toFixed(2)} m` : "Unknown"}</strong>
                  {sensor.scanner && <small>{reading?.angle_deg.toFixed(0) ?? "--"}° head</small>}
                </div>
              </header>

              <div className="setting-field-grid">
                <NumberField label="Right position" value={sensor.display_pose.x_m} min={-2} max={2} step={0.01} unit="m" onChange={(value) => changePose("x_m", value)} />
                <NumberField label="Forward position" value={sensor.display_pose.y_m} min={-2} max={2} step={0.01} unit="m" onChange={(value) => changePose("y_m", value)} />
                <NumberField label="Height" value={sensor.display_pose.z_m} min={0} max={2} step={0.01} unit="m" onChange={(value) => changePose("z_m", value)} />
                <NumberField label="Yaw" value={sensor.display_pose.yaw_deg} min={-180} max={180} step={1} unit="°" onChange={(value) => changePose("yaw_deg", value)} />
                <NumberField label="Pitch" value={sensor.display_pose.pitch_deg} min={-90} max={90} step={1} unit="°" onChange={(value) => changePose("pitch_deg", value)} />
                <NumberField label="Alert inside" value={sensor.alert_distance_m} min={0.05} max={8} step={0.05} unit="m" onChange={(value) => onSensorChange(sensor.sensor_id, { ...sensor, alert_distance_m: value })} />
                <NumberField label="Visual range" value={sensor.visual_range_m} min={0.1} max={8} step={0.1} unit="m" onChange={(value) => onSensorChange(sensor.sensor_id, { ...sensor, visual_range_m: value })} />
              </div>

              <button type="submit" className="secondary-action">Save {sensor.label}</button>
            </form>
          );
        })}
      </div>

      <div className={`settings-save-state settings-save-state-${settingsConnection.toLowerCase()}`} role="status" aria-live="polite">
        {message ?? (settingsConnection === "SAVED" ? "Display settings are synced." : "Loading display settings...")}
      </div>
    </section>
  );
}
