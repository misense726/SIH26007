import type { WorldState } from "../types";

function overlayStrength(score: number): number {
  return Math.min(0.92, Math.max(0.22, 1.02 - score));
}

export function CameraAwareness({ world }: { world: WorldState }) {
  const visibility = Math.round(world.environment.visibility_score * 100);
  const stateClass = world.emergency.state.toLowerCase().replace("_", "-");

  return (
    <article className="camera-awareness">
      <div className="panel-heading camera-heading">
        <div>
          <p className="eyebrow">Forward camera</p>
          <h2>Driver awareness</h2>
        </div>
        <div className="camera-badges">
          <span className="source-badge">{world.mode}</span>
          <span className="visibility-badge">Visibility {visibility}%</span>
        </div>
      </div>

      <div className={`camera-stage emergency-stage-${stateClass}`}>
        <div className="mine-silhouette" aria-hidden="true">
          <span className="ridge ridge-left" />
          <span className="ridge ridge-right" />
        </div>
        <div className="perspective-road" aria-hidden="true">
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
        <div className="camera-unavailable">
          <strong>Camera unavailable</strong>
          <span>Synthetic awareness remains active</span>
        </div>
        <div className="camera-horizon">
          <span>SAFE CORRIDOR</span>
          <strong>{world.safe_corridor.state}</strong>
        </div>
      </div>
    </article>
  );
}

