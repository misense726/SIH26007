import type { RangeReading, SpatialPoint, VehiclePose, WorldState } from "../types";
import type { ConnectionState } from "../state/useTelemetry";
import { TofRangePlot } from "./ProximityWidget";
import {
  shouldShowTofOverlay,
  usableRangeReadings,
  type AwarenessMode,
} from "./driverAwareness";

const awarenessModes: Array<{ value: AwarenessMode; label: string }> = [
  { value: "AUTO", label: "Auto" },
  { value: "CAMERA", label: "Camera" },
  { value: "TOF_OVERLAY", label: "ToF overlay" },
];

function overlayStrength(score: number): number {
  return Math.min(0.92, Math.max(0.22, 1.02 - score));
}

interface CameraAwarenessProps {
  world: WorldState;
  readings: RangeReading[];
  points: SpatialPoint[];
  vehicle: VehiclePose;
  mode: AwarenessMode;
  onModeChange: (mode: AwarenessMode) => void;
  connection: ConnectionState;
}

export function CameraAwareness({
  world,
  readings,
  points,
  vehicle,
  mode,
  onModeChange,
  connection,
}: CameraAwarenessProps) {
  const telemetryConnected = connection === "CONNECTED";
  const visibility = Math.round(world.environment.visibility_score * 100);
  const corridorState = telemetryConnected ? world.safe_corridor.state : "GREY";
  const showSimulatedCamera =
    telemetryConnected && world.mode === "SIMULATED" && world.camera.raw_available;
  const autoWantsTof = shouldShowTofOverlay(mode, world.environment.visibility_state);
  const showTofOverlay = mode === "TOF_OVERLAY" || (telemetryConnected && autoWantsTof);
  const usableReadings = usableRangeReadings(readings);
  const nearestRange = usableReadings.length
    ? Math.min(...usableReadings.map((reading) => reading.range_m))
    : null;
  const rangeLabel = `ToF spatial view with ${points.length} mapped returns from ${usableReadings.length} valid readings.${
    nearestRange === null ? "" : ` Nearest range ${nearestRange.toFixed(2)} metres.`
  }`;
  const modeStatus = connection === "CONNECTING"
    ? "Connecting to telemetry. ToF unavailable"
    : connection === "DISCONNECTED"
      ? "Telemetry disconnected. ToF unavailable"
      : mode === "AUTO"
        ? showTofOverlay
          ? "Low visibility. ToF overlay active"
          : "Camera view. ToF turns on when visibility is low"
        : showTofOverlay
          ? "ToF overlay active"
          : "Camera view";

  return (
    <article className="camera-awareness">
      <div className="panel-heading camera-heading">
        <div>
          <p className="eyebrow">Forward camera</p>
          <h2>Driver awareness</h2>
        </div>
        <div className="camera-badges">
          <span className="source-badge">
            {telemetryConnected ? world.mode : connection === "CONNECTING" ? "CONNECTING" : "NO TELEMETRY"}
          </span>
          <span className="visibility-badge">
            {telemetryConnected ? `Visibility ${visibility}%` : "Visibility unavailable"}
          </span>
        </div>
      </div>

      <div className="awareness-toolbar">
        <div className="awareness-mode-switcher" role="group" aria-label="Driver awareness display">
          {awarenessModes.map((awarenessMode) => (
            <button
              key={awarenessMode.value}
              type="button"
              className={mode === awarenessMode.value ? "active" : ""}
              aria-pressed={mode === awarenessMode.value}
              onClick={() => onModeChange(awarenessMode.value)}
            >
              {awarenessMode.label}
            </button>
          ))}
        </div>
        <span
          className={`awareness-mode-status ${showTofOverlay && telemetryConnected ? "active" : ""}`}
          role="status"
          aria-live="polite"
        >
          {modeStatus}
        </span>
      </div>

      <div className="camera-stage">
        <div className="mine-silhouette" aria-hidden="true">
          <span className="ridge ridge-left" />
          <span className="ridge ridge-right" />
        </div>
        <div
          className={`perspective-road corridor-visual-${corridorState.toLowerCase()}`}
          aria-hidden="true"
        >
          <span className="corridor-fill" />
          <span className="lane-edge lane-edge-left" />
          <span className="lane-edge lane-edge-right" />
          <span className="lane-center" />
        </div>
        <div
          className="fog-layer"
          style={{ opacity: overlayStrength(world.environment.visibility_score) }}
          aria-hidden="true"
        />
        {showSimulatedCamera ? (
          <span className="camera-preview-label">Simulated camera</span>
        ) : (
          <div className="camera-unavailable">
            <strong>{telemetryConnected ? "Camera preview unavailable" : "Camera telemetry unavailable"}</strong>
            <span>
              {telemetryConnected ? "Synthetic awareness remains active" : "Waiting for live telemetry"}
            </span>
          </div>
        )}
        {showTofOverlay && (
          <div className="tof-camera-overlay">
            <div className="tof-overlay-summary">
              <span>ToF spatial view</span>
              <strong>
                {usableReadings.length === 0
                  ? "No valid readings"
                  : `${usableReadings.length} inputs, ${points.length} mapped returns`}
              </strong>
            </div>
            {(usableReadings.length > 0 || points.length > 0) && (
              <TofRangePlot
                points={points}
                vehicle={vehicle}
                className="proximity-svg tof-overlay-grid"
                label={rangeLabel}
              />
            )}
          </div>
        )}
        <div className="camera-horizon">
          <span>SAFE CORRIDOR</span>
          <strong className={`corridor-${corridorState.toLowerCase()}`}>
            {corridorState}
          </strong>
        </div>
      </div>
    </article>
  );
}
