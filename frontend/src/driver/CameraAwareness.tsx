import { useEffect, useState } from "react";
import type { VehiclePose, WorldState } from "../types";
import type { ConnectionState } from "../state/useTelemetry";
import { CampusMinimap } from "./CampusMinimap";
import { IRCameraCanvas } from "./IRCameraCanvas";
import { LidarPointCloud } from "./LidarPointCloud";
import type { AwarenessMode } from "./driverAwareness";

const awarenessModes: Array<{ value: AwarenessMode; label: string }> = [
  { value: "CAMERA", label: "Camera" },
  { value: "LIDAR", label: "LiDAR" },
];

interface CameraAwarenessProps {
  world: WorldState;
  vehicle: VehiclePose;
  mode: AwarenessMode;
  onModeChange: (mode: AwarenessMode) => void;
  connection: ConnectionState;
  onExpandMap?: () => void;
}

export function CameraAwareness({
  world,
  vehicle,
  mode,
  onModeChange,
  connection,
  onExpandMap,
}: CameraAwarenessProps) {
  const [cameraStreamFailed, setCameraStreamFailed] = useState(false);
  const [cameraRetry, setCameraRetry] = useState(0);
  const telemetryConnected = connection === "CONNECTED";
  const cameraVisibilityScore = world.camera.raw_available
    ? world.camera.visibility_score ?? world.environment.visibility_score
    : world.environment.visibility_score;
  const visibility = Math.round(cameraVisibilityScore * 100);
  const liveCameraAvailable =
    telemetryConnected &&
    world.mode === "LIVE" &&
    world.camera.mode === "LIVE" &&
    world.camera.raw_available;
  const simulatedCameraAvailable =
    world.mode === "SIMULATED" && world.camera.mode === "SIMULATED";
  const cameraAvailable = liveCameraAvailable || simulatedCameraAvailable;
  const lidarAvailable = telemetryConnected;
  const cameraSource = liveCameraAvailable
    ? `/api/camera/stream?view=raw&retry=${cameraRetry}`
    : "/camera/haul_truck_ir.png";
  const showCamera = mode === "CAMERA";
  const showLidar = mode === "LIDAR";

  const sourceLabel = showLidar
    ? lidarAvailable
      ? world.mode === "SIMULATED"
        ? "LIDAR SIMULATED"
        : "LIDAR LIVE"
      : "LIDAR UNAVAILABLE"
    : cameraStreamFailed
      ? "CAMERA STREAM ERROR"
      : liveCameraAvailable
        ? "MONO CAMERA LIVE"
        : simulatedCameraAvailable
          ? "MONO CAMERA SIMULATED"
          : telemetryConnected && world.camera.mode === "REPLAY"
            ? "CAMERA REPLAY"
            : telemetryConnected
              ? "CAMERA UNAVAILABLE"
              : connection === "CONNECTING"
                ? "CONNECTING"
                : "NO TELEMETRY";

  const frameDetail =
    showCamera &&
    liveCameraAvailable &&
    world.camera.width_px &&
    world.camera.height_px
      ? `${world.camera.width_px}×${world.camera.height_px} · ${(world.camera.measured_fps ?? 0).toFixed(1)} FPS`
      : null;

  useEffect(() => {
    setCameraStreamFailed(false);
  }, [cameraSource, mode, world.camera.stream_status]);

  function retryCameraStream() {
    setCameraStreamFailed(false);
    setCameraRetry((retry) => retry + 1);
  }

  return (
    <article className="camera-awareness">
      <div className="panel-heading camera-heading">
        <div>
          <p className="eyebrow">Forward awareness</p>
          <h2>Driver awareness</h2>
        </div>
        <div className="camera-badges">
          <span className="source-badge">{sourceLabel}</span>
          <span className="visibility-badge">
            {showLidar
              ? "Vehicle frame · 80 m"
              : telemetryConnected
                ? `Visibility ${visibility}%`
                : "Visibility unavailable"}
          </span>
        </div>
      </div>

      <div className="awareness-toolbar">
        <div
          className="awareness-mode-switcher awareness-primary-switcher"
          role="group"
          aria-label="Driver awareness display"
        >
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
        <span className="sr-only" role="status" aria-live="polite">
          {showLidar ? "LiDAR active" : "Camera active"}
        </span>
      </div>

      <div
        className={`camera-stage ${world.mode === "LIVE" ? "camera-stage-live" : ""} ${showLidar ? "camera-stage-lidar" : ""}`}
      >
        {showLidar && lidarAvailable ? (
          <LidarPointCloud world={world} vehicle={vehicle} />
        ) : showCamera && cameraAvailable && !cameraStreamFailed ? (
          <IRCameraCanvas
            src={cameraSource}
            alt="Monochrome forward camera feed"
            continuous={liveCameraAvailable}
            onError={() => setCameraStreamFailed(true)}
          />
        ) : (
          <div className="camera-unavailable" role="status" aria-live="polite">
            <strong>
              {showLidar
                ? "LIDAR UNAVAILABLE"
                : cameraStreamFailed
                  ? "LIVE CAMERA STREAM ERROR"
                  : "CAMERA UNAVAILABLE"}
            </strong>
            <span>
              {showLidar
                ? "Vehicle, map, and ranging telemetry are unavailable."
                : world.mode === "LIVE"
                  ? "No live camera stream is available."
                  : world.mode === "REPLAY"
                    ? "Replay camera frames are not available."
                    : "Simulation camera data is unavailable."}
            </span>
            {showCamera && world.mode === "LIVE" && (
              <button type="button" onClick={retryCameraStream}>
                Retry live camera
              </button>
            )}
          </div>
        )}

        {frameDetail && !cameraStreamFailed && (
          <span className="camera-preview-label">{frameDetail}</span>
        )}

        {telemetryConnected && (
          <div className="camera-minimap-overlay">
            <CampusMinimap
              world={world}
              vehicle={vehicle}
              onExpand={onExpandMap ?? (() => {})}
            />
          </div>
        )}
      </div>
    </article>
  );
}
