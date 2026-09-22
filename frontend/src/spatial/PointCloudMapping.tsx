import { useEffect, useMemo, useRef, useState } from "react";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import type { VehiclePose, WorldState } from "../types";
import { buildLidarFrame, type SpatialPreview } from "./mappingFrame";
import { createLidarRenderer, type LidarRenderer } from "./mappingRenderer";

let previewRequest: Promise<SpatialPreview> | null = null;
function loadPreview() {
  return previewRequest ??= fetch("/spatial-preview.json")
    .then(async response => {
      if (!response.ok) throw new Error("Preview unavailable");
      const preview: SpatialPreview = await response.json();
      if (preview.source !== "SIMULATED" || preview.coordinate_frame !== "VEHICLE_X_RIGHT_Y_FORWARD_Z_UP" ||
        !Array.isArray(preview.points) || !Array.isArray(preview.entities)) throw new Error("Invalid preview");
      return preview;
    }).catch(error => { previewRequest = null; throw error; });
}

export function PointCloudMapping({ world, vehicle, sensors, connected }: {
  world: WorldState; vehicle: VehiclePose; sensors: SensorDisplaySetting[]; connected: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<LidarRenderer | null>(null);
  const [preview, setPreview] = useState<SpatialPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const frame = useMemo(() => buildLidarFrame(world, vehicle, sensors, connected, preview),
    [world, vehicle, sensors, connected, preview]);
  const needsPreview = frame.source === "WAITING" && world.mode !== "REPLAY";
  useEffect(() => {
    if (!needsPreview) return;
    let cancelled = false;
    loadPreview().then(value => { if (!cancelled) { setPreview(value); setPreviewError(null); } })
      .catch(() => { if (!cancelled) setPreviewError("Surroundings unavailable"); });
    return () => { cancelled = true; };
  }, [needsPreview]);

  useEffect(() => {
    if (!container.current) return;
    try { renderer.current = createLidarRenderer(container.current); }
    catch { setError("3D view unavailable. Enable browser graphics acceleration."); }
    return () => { renderer.current?.dispose(); renderer.current = null; };
  }, []);
  useEffect(() => { renderer.current?.update(frame); }, [frame]);

  const simulatedPreview = frame.source === "SIMULATED_PREVIEW";
  const waiting = frame.source === "WAITING";
  return <div className="point-cloud-stage">
    <div ref={container} className="point-cloud-canvas" role="img"
      aria-label={`Spatial point cloud: ${frame.measuredCount} measured returns${simulatedPreview ? ", simulated preview" : ""}`} />
    <div className="point-cloud-topline">
      <span className={`point-cloud-source ${simulatedPreview || waiting ? "is-preview" : ""}`}>
        {simulatedPreview ? "SIMULATED PREVIEW" : waiting ? "Awaiting surroundings"
          : frame.source === "REFERENCE_SIMULATION" ? "SIMULATED MAPPING" : `${world.mode} ToF`}
      </span>
      <span>{vehicle.vehicle_id}</span>
    </div>
    <div className="point-cloud-footer">
      <div><strong>{simulatedPreview ? "Preview surroundings" : "Surroundings"}</strong>
        <span>{simulatedPreview ? "No recent sensor returns. Showing a simulated scene."
          : waiting ? world.mode === "REPLAY" ? "No spatial returns in this recording." : error ?? previewError ?? "Loading simulated preview…"
          : frame.source === "REFERENCE_SIMULATION" ? `${frame.roadPointCount.toLocaleString()} map points · ${frame.measuredCount} ToF returns`
          : `${frame.measuredCount} measured returns · 2.5D ToF`}</span></div>
      {!waiting && <span className="point-cloud-key"><i />{simulatedPreview ? "Simulated objects" : "Tracked objects"}</span>}
    </div>
    {error && !waiting && <p role="status" className="point-cloud-error">{error}</p>}
  </div>;
}
