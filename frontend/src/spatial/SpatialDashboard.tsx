import { useRef } from "react";
import { availableRangeReadings } from "../state/rangeReadings";
import { primaryVehicle, primaryVehicleOrNull } from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import type { WorldState } from "../types";
import { getSensorThreatLevel } from "./spatialProjection";
import { PointCloudMapping } from "./PointCloudMapping";
import { selectSimulatedForwardHazard, type ForwardHazard } from "./forwardHazard";
import "./spatial.css";

interface SpatialDashboardProps {
  world: WorldState;
  connection: ConnectionState;
  sensorSettings: SensorDisplaySetting[];
}

export function SpatialDashboard({ world, connection, sensorSettings }: SpatialDashboardProps) {
  const forwardRef = useRef<ForwardHazard | null>(null);
  const reported = primaryVehicleOrNull(world);
  const connected = connection === "CONNECTED" && reported !== null;
  const vehicle = reported ?? primaryVehicle(world);
  const ranges = availableRangeReadings(world.ranges, world.sensor_health, connected)
    .filter(reading => world.generated_at_ms - reading.timestamp_ms <= 2000 &&
      world.generated_at_ms >= reading.timestamp_ms);
  const hazard = world.mode === "SIMULATED" ? undefined : sensorSettings.map(sensor => {
    const reading = ranges.find(item => item.sensor_id === sensor.sensor_id);
    return { sensor, reading, threat: getSensorThreatLevel(reading, sensor) };
  }).find(item => item.threat === "ALERT");
  const forward = connected ? selectSimulatedForwardHazard(world, vehicle, forwardRef.current) : null;
  forwardRef.current = forward;
  const backendWarning = connected && (world.mode === "SIMULATED"
    ? world.emergency.state === "EMERGENCY_STOP" : world.emergency.state !== "SAFE");
  const emergency = backendWarning && world.emergency.state !== "WARNING";
  const alertTitle = emergency ? world.emergency.state === "EMERGENCY_STOP"
    ? "Automatic Emergency Stop Simulation" : "Critical proximity"
    : forward?.title ?? (hazard ? `Proximity hazard: ${hazard.sensor.label}` : "Warning active");

  return <section className="dashboard spatial-dashboard spatial-mapping-page" aria-label="Spatial mapping">
    <header className="page-heading spatial-page-heading">
      <h2>Spatial view</h2>
      <div className="spatial-mode-status">
        <span>{connected ? "Telemetry connected" : connection === "CONNECTED" ? "Vehicle data unavailable" : "Telemetry unavailable"}</span>
        <span className="source-badge">{world.mode}</span>
      </div>
    </header>
    {(hazard || forward || backendWarning) && <div role="alert" className={`spatial-alert spatial-alert-danger ${world.mode === "SIMULATED" ? "simulated-spatial-warning" : ""}`}>
      <strong>{alertTitle}</strong>
      <span>{emergency ? world.emergency.reason : forward ? forward.detail
        : hazard ? `${hazard.reading!.range_m.toFixed(2)} m from sensor. Check the surroundings.`
          : world.emergency.reason}</span>
    </div>}
    <PointCloudMapping key={`${world.mode}:${world.primary_vehicle_id}`} world={world} vehicle={vehicle}
      sensors={sensorSettings} connected={connected} />
  </section>;
}
