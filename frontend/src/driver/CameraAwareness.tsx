import { useState } from "react";
import type { RangeReading, SpatialPoint, VehiclePose, WorldState } from "../types";
import type { ConnectionState } from "../state/useTelemetry";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import { CampusMinimap } from "./CampusMinimap";
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
  sensorSettings: SensorDisplaySetting[];
  mode: AwarenessMode;
  onModeChange: (mode: AwarenessMode) => void;
  connection: ConnectionState;
  onExpandMap?: () => void;
}

export function CameraAwareness({
  world,
  readings,
  points,
  vehicle,
  sensorSettings,
  mode,
  onModeChange,
  connection,
  onExpandMap,
}: CameraAwarenessProps) {
  const [cameraView, setCameraView] = useState<"RAW" | "ENHANCED" | "IR">("RAW");
  const telemetryConnected = connection === "CONNECTED";
  const cameraVisibilityScore = world.camera.raw_available
    ? world.camera.visibility_score ?? world.environment.visibility_score
    : world.environment.visibility_score;
  const cameraVisibilityState = world.camera.raw_available
    ? world.camera.visibility_state ?? world.environment.visibility_state
    : world.environment.visibility_state;
  const visibility = Math.round(cameraVisibilityScore * 100);
  const corridorState = telemetryConnected ? world.safe_corridor.state : "GREY";
  const showLiveCamera =
    telemetryConnected && world.camera.mode === "LIVE" && world.camera.raw_available;
  const showEnhancedCamera =
    showLiveCamera && cameraView === "ENHANCED" && world.camera.enhancement_available;
  const showIRCamera =
    showLiveCamera && cameraView === "IR" && world.camera.ir_available;
  const showSimulatedCamera =
    telemetryConnected && world.camera.mode === "SIMULATED" && world.camera.raw_available;
  const autoWantsTof = shouldShowTofOverlay(mode, cameraVisibilityState);
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
  const isIrGpu = (world.camera.ir_device ?? "").toLowerCase() === "cuda";
  const sourceLabel = showLiveCamera
    ? showIRCamera
      ? isIrGpu
        ? "IR LIVE · GPU"
        : "IR LIVE · CPU"
      : showEnhancedCamera
        ? "DEHAZED LIVE · GPU"
        : "CAMERA LIVE · WI-FI"
    : showSimulatedCamera
      ? "CAMERA SIMULATED"
      : telemetryConnected
        ? "CAMERA UNAVAILABLE"
        : connection === "CONNECTING"
          ? "CONNECTING"
          : "NO TELEMETRY";
  const cameraStreamSrc = showIRCamera
    ? "/api/camera/stream?view=ir"
    : showEnhancedCamera
      ? "/api/camera/stream?view=enhanced"
      : "/api/camera/stream?view=raw";
  const cameraAlt = showIRCamera
    ? "Infrared view from the Raspberry Pi camera"
    : showEnhancedCamera
      ? "ML-dehazed forward view from the Raspberry Pi camera"
      : "Raw forward view from the Raspberry Pi camera";
  const frameDetail = showLiveCamera && world.camera.width_px && world.camera.height_px
    ? showIRCamera
      ? `${world.camera.ir_model ?? "IR"} · ${world.camera.ir_fps.toFixed(1)} FPS · ${Math.round(world.camera.ir_latency_ms ?? 0)} ms`
      : showEnhancedCamera
        ? `${world.camera.enhancement_model ?? "ML dehazing"} · ${world.camera.enhancement_fps.toFixed(1)} FPS · ${Math.round(world.camera.enhancement_latency_ms ?? 0)} ms`
        : `${world.camera.width_px}×${world.camera.height_px} · ${world.camera.measured_fps.toFixed(1)} FPS`
    : null;

  return (
    <article className="camera-awareness">
      <div className="panel-heading camera-heading">
        <div>
          <p className="eyebrow">Forward camera</p>
          <h2>Driver awareness</h2>
        </div>
        <div className="camera-badges">
          <span className="source-badge">
            {sourceLabel}
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
        {showLiveCamera && (
          <div className="awareness-mode-switcher" role="group" aria-label="Camera processing">
            <button
              type="button"
              className={cameraView === "RAW" ? "active" : ""}
              aria-pressed={cameraView === "RAW"}
              onClick={() => setCameraView("RAW")}
            >
              Raw
            </button>
            <button
              type="button"
              className={showEnhancedCamera ? "active" : ""}
              aria-pressed={showEnhancedCamera}
              disabled={!world.camera.enhancement_available}
              title={world.camera.enhancement_detail ?? undefined}
              onClick={() => setCameraView("ENHANCED")}
            >
              Dehazed
            </button>
            <button
              type="button"
              className={showIRCamera ? "active" : ""}
              aria-pressed={showIRCamera}
              disabled={!world.camera.ir_available}
              title={world.camera.ir_detail ?? undefined}
              onClick={() => setCameraView("IR")}
            >
              IR
            </button>
          </div>
        )}
        <span
          className={`awareness-mode-status ${showTofOverlay && telemetryConnected ? "active" : ""}`}
          role="status"
          aria-live="polite"
        >
          {modeStatus}
        </span>
      </div>

      <div className={`camera-stage ${showLiveCamera ? "camera-stage-live" : ""}`}>
        {showLiveCamera ? (
          <img
            className="camera-feed"
            src={cameraStreamSrc}
            alt={cameraAlt}
          />
        ) : (
          <>
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
          </>
        )}
        {showLiveCamera && frameDetail ? (
          <span className="camera-preview-label">{frameDetail}</span>
        ) : showSimulatedCamera ? (
          <span className="camera-preview-label">Simulated camera</span>
        ) : (
          <div className="camera-unavailable">
            <strong>{telemetryConnected ? "Camera preview unavailable" : "Camera telemetry unavailable"}</strong>
            <span>
              {telemetryConnected
                ? world.camera.stream_detail ?? "Synthetic awareness remains active"
                : "Waiting for live telemetry"}
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
                sensors={sensorSettings}
                readings={readings}
                className="proximity-svg tof-overlay-grid"
                label={rangeLabel}
              />
            )}
          </div>
        )}

        {/* Compact road navigation map */}
        <div className="camera-minimap-overlay">
          <CampusMinimap
            world={world}
            vehicle={vehicle}
            onExpand={onExpandMap ?? (() => {})}
          />
        </div>
      </div>
    </article>
  );
}
