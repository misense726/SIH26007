import { useEffect, useState } from "react";
import { fetchNavigationGuidance } from "../api/mineApi";
import type { GuidanceResponse, WorldState } from "../types";

interface DriverGuidanceHUDProps {
  world: WorldState;
  vehicleTelemetryAvailable: boolean;
}

export function DriverGuidanceHUD({
  world,
  vehicleTelemetryAvailable,
}: DriverGuidanceHUDProps) {
  const [restGuidance, setRestGuidance] = useState<GuidanceResponse | null>(null);

  // Use canonical guidance from WorldState if present, otherwise polled fallback
  const canonicalGuidance = world.operations?.guidance?.[world.primary_vehicle_id];

  useEffect(() => {
    let mounted = true;

    async function loadGuidance() {
      try {
        const data = await fetchNavigationGuidance(world.primary_vehicle_id);
        if (mounted) setRestGuidance(data);
      } catch {
        // Fallback or offline
      }
    }

    loadGuidance();
    const interval = setInterval(loadGuidance, 1500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [world.primary_vehicle_id]);

  const guidance = canonicalGuidance ?? restGuidance;

  const visScore = world.environment.visibility_score;
  const visState = world.environment.visibility_state;
  const estimatedSightM = Math.max(8, Math.round(visScore * 120));

  // If vehicle telemetry is unavailable or guidance not yet received, fail-closed to UNVERIFIED/GREY
  if (!vehicleTelemetryAvailable || !guidance) {
    return (
      <div className="driver-guidance-hud hud-offline" aria-label="Tactical guidance offline">
        <div className="guidance-hud-card">
          <div className="hud-card-header">
            <span className="hud-eyebrow">Tactical Guidance</span>
            <span className="hud-status-badge badge-grey">UNVERIFIED</span>
          </div>
          <p className="hud-instruction">
            {!vehicleTelemetryAvailable
              ? "Waiting for vehicle telemetry connection..."
              : "Waiting for verified tactical guidance stream..."}
          </p>
        </div>
      </div>
    );
  }

  const destination = guidance.current_destination;
  const distanceRem = guidance.distance_remaining_m;
  const instruction = guidance.next_instruction;

  const threatLevel = guidance.threat_level;
  const threatClass = threatLevel.toLowerCase();
  const targetCallsign = guidance.target_callsign;
  const targetDist = guidance.hazard_distance_m;
  const targetDir = guidance.hazard_direction;
  const closingVel = guidance.closing_velocity_mps;
  const advisoryText = guidance.advisory_text;

  return (
    <section className="driver-guidance-hud" aria-label="Driver tactical guidance and collision warning">
      {/* 1. Tactical Collision Warning Card (High Visibility) */}
      <article
        className={`tactical-collision-card threat-${threatClass} ${threatLevel === "CRITICAL" ? "threat-pulse-critical" : threatLevel === "WARNING" ? "threat-pulse-warning" : ""}`}
        role={threatLevel !== "SAFE" ? "alert" : "status"}
        aria-live={threatLevel !== "SAFE" ? "assertive" : "polite"}
      >
        <div className="tactical-card-top">
          <div className="tactical-threat-indicator">
            <span className={`threat-pill pill-${threatClass}`}>{threatLevel}</span>
            <span className="threat-title">
              {threatLevel === "SAFE" ? "V2V Proximity Clear" : "Collision Warning"}
            </span>
          </div>
          {threatLevel !== "SAFE" && (
            <div className="closing-velocity-chip">
              <span className="closing-label">Closing</span>
              <strong>+{closingVel.toFixed(1)} m/s</strong>
            </div>
          )}
        </div>

        <div className="tactical-threat-body">
          <div className="threat-direction-compass" aria-hidden="true">
            <div className={`compass-bearing-arrow dir-${targetDir.toLowerCase()}`}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                <path d="M12 2 L19 21 L12 17 L5 21 Z" />
              </svg>
            </div>
            <span className="direction-label">{targetDir}</span>
          </div>

          <div className="threat-details">
            <div className="target-id-row">
              <span className="target-eyebrow">Tracked Target</span>
              <strong className="target-callsign">{targetCallsign}</strong>
            </div>
            <div className="target-distance-row">
              <span className="dist-num">
                {targetDist < 900 ? targetDist.toFixed(1) : "--"}
              </span>
              <span className="dist-unit">metres</span>
            </div>
          </div>
        </div>

        <p className="tactical-advisory-note">{advisoryText}</p>
      </article>

      {/* 2. Route Destination & Next Maneuver */}
      <article className="guidance-destination-card">
        <div className="hud-card-header">
          <div>
            <span className="hud-eyebrow">Haul Destination</span>
            <h4 className="destination-name">{destination}</h4>
          </div>
          <div className="distance-remaining-tag">
            <strong>{distanceRem > 1000 ? `${(distanceRem / 1000).toFixed(2)} km` : `${distanceRem.toFixed(0)} m`}</strong>
            <small>remaining</small>
          </div>
        </div>

        <div className="hud-next-instruction">
          <span className="instruction-icon" aria-hidden="true">➔</span>
          <p>{instruction}</p>
        </div>
      </article>

      {/* 3. Fog / Visibility State Indicator */}
      <article className={`fog-visibility-card vis-${visState.toLowerCase()}`}>
        <div className="fog-card-left">
          <span className="hud-eyebrow">Atmospheric Sight</span>
          <div className="visibility-readout">
            <strong>{Math.round(visScore * 100)}%</strong>
            <span className="vis-state-tag">{visState.replace("_", " ")}</span>
          </div>
        </div>
        <div className="fog-card-right">
          <span className="sight-metric-label">Estimated Sight Dist</span>
          <strong className="sight-metric-value">{estimatedSightM} m</strong>
          <small className="synthetic-status">
            {visScore < 0.35 ? "SYNTHETIC GUIDANCE LOCKED" : "NORMAL VISUAL SIGHT"}
          </small>
        </div>
      </article>
    </section>
  );
}
