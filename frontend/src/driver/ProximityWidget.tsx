import type { RangeReading, SensorHealth, SpatialPoint, VehiclePose } from "../types";
import { isUsableRangeReading } from "../state/rangeReadings";
import { TOF_SENSOR_IDS } from "../state/selectors";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import { spatialPointToPlot } from "./driverAwareness";

export { spatialPointToPlot } from "./driverAwareness";

function displayName(sensorId: string): string {
  return sensorId
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

interface TofRangePlotProps {
  points: SpatialPoint[];
  vehicle: VehiclePose;
  sensors: SensorDisplaySetting[];
  readings: RangeReading[];
  className?: string;
  label?: string;
}

function sensorPlotOrigin(sensor: SensorDisplaySetting): { x: number; y: number } {
  return {
    x: 120 + sensor.display_pose.x_m * 44,
    y: 120 - sensor.display_pose.y_m * 44,
  };
}

function sensorPlotDirection(
  sensor: SensorDisplaySetting,
  reading: RangeReading | undefined,
): { x: number; y: number } {
  const origin = sensorPlotOrigin(sensor);
  const yaw = sensor.display_pose.yaw_deg + (sensor.scanner ? reading?.angle_deg ?? 0 : 0);
  const pitchRadians = (sensor.display_pose.pitch_deg * Math.PI) / 180;
  const length = 17 * Math.max(0, Math.cos(pitchRadians));
  const yawRadians = (yaw * Math.PI) / 180;
  return {
    x: origin.x + Math.sin(yawRadians) * length,
    y: origin.y - Math.cos(yawRadians) * length,
  };
}

export function TofRangePlot({
  points,
  vehicle,
  sensors,
  readings,
  className = "proximity-svg",
  label,
}: TofRangePlotProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      role="img"
      aria-label={label ?? `Vehicle-centred ToF view with ${points.length} mapped returns`}
    >
      <circle className="proximity-band" cx="120" cy="120" r="91" />
      <circle className="proximity-band" cx="120" cy="120" r="62" />
      <circle className="proximity-band" cx="120" cy="120" r="35" />
      <path className="proximity-axis" d="M120 20V220M20 120H220" />
      {points.map((point, index) => {
        const endpoint = spatialPointToPlot(point, vehicle);
        return (
          <circle
            key={`${point.source_sensor_id}-${point.timestamp_ms}-${index}`}
            className={`range-hit ${point.quality < 0.65 ? "range-hit-low" : ""}`}
            cx={endpoint.x}
            cy={endpoint.y}
            r="3.4"
          >
            <title>
              {`${displayName(point.source_sensor_id)} return: ${endpoint.distance_m.toFixed(2)} m from vehicle`}
            </title>
          </circle>
        );
      })}
      <g className="vehicle-glyph">
        <rect x="104" y="93" width="32" height="54" rx="9" />
        <path d="M120 83l8 12h-16z" />
        <circle cx="120" cy="120" r="4" />
      </g>
      <g className="tof-sensor-layout" aria-label="Configured ToF sensor positions">
        {sensors.map((sensor) => {
          const origin = sensorPlotOrigin(sensor);
          const endpoint = sensorPlotDirection(sensor, latestReading(readings, sensor.sensor_id));
          const pitch = sensor.display_pose.pitch_deg;
          const sensorClass = `sensor-${sensor.sensor_id.replaceAll("_", "-")}`;
          return (
            <g
              key={sensor.sensor_id}
              className={`tof-sensor-marker ${sensorClass} ${pitch < -5 ? "tof-sensor-marker-down" : ""}`}
            >
              <line
                className="tof-sensor-direction"
                x1={origin.x}
                y1={origin.y}
                x2={endpoint.x}
                y2={endpoint.y}
              />
              <circle className="tof-sensor-origin" cx={origin.x} cy={origin.y} r={sensor.scanner ? 5 : 4} />
              {pitch < -5 && <circle className="tof-sensor-down-point" cx={endpoint.x} cy={endpoint.y} r="2" />}
              <title>
                {`${sensor.label}: ${sensor.scanner ? "servo head" : "fixed"}, ${sensor.display_pose.pitch_deg.toFixed(0)}° pitch`}
              </title>
            </g>
          );
        })}
      </g>
      <text x="120" y="13" textAnchor="middle">FRONT</text>
    </svg>
  );
}

interface ProximityWidgetProps {
  points: SpatialPoint[];
  vehicle: VehiclePose;
  validReadingCount: number;
  readings: RangeReading[];
  sensorHealth: SensorHealth[];
  sensorSettings: SensorDisplaySetting[];
  telemetryConnected: boolean;
}

const SENSOR_LABELS: Record<(typeof TOF_SENSOR_IDS)[number], string> = {
  front_scanner: "Front scanner",
  front_fixed: "Front fixed",
  rear_scanner: "Rear scanner",
  left_side: "Left side",
  right_side: "Right side",
};

function latestReading(readings: RangeReading[], sensorId: string): RangeReading | undefined {
  return readings
    .filter((reading) => reading.sensor_id === sensorId)
    .sort((left, right) => right.timestamp_ms - left.timestamp_ms)[0];
}

export function ProximityWidget({
  points,
  vehicle,
  validReadingCount,
  readings,
  sensorHealth,
  sensorSettings,
  telemetryConnected,
}: ProximityWidgetProps) {
  const healthBySensor = new Map(
    sensorHealth.map((sensor) => [sensor.sensor_id, sensor]),
  );

  return (
    <article className="proximity-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Range awareness</p>
          <h2>360° proximity</h2>
        </div>
        <span className="source-badge">ToF 2D/2.5D</span>
      </div>
      <TofRangePlot
        points={points}
        vehicle={vehicle}
        sensors={sensorSettings}
        readings={readings}
        label={`Vehicle-centred ToF view with ${points.length} mapped returns`}
      />
      {points.length === 0 && (
        <p className="proximity-empty">
          {validReadingCount > 0
            ? `${validReadingCount} valid readings. No mapped returns.`
            : "No valid ToF readings."}
        </p>
      )}
      <div className="proximity-sensor-grid" aria-label="Live ToF sensor readings">
        {TOF_SENSOR_IDS.map((sensorId) => {
          const health = healthBySensor.get(sensorId);
          const status = telemetryConnected ? health?.status ?? "OFFLINE" : "OFFLINE";
          const reading = latestReading(readings, sensorId);
          const available =
            telemetryConnected &&
            (status === "HEALTHY" || status === "DEGRADED") &&
            Boolean(reading && isUsableRangeReading(reading));
          const isScanner = sensorId === "front_scanner" || sensorId === "rear_scanner";
          const meta = available && reading
            ? isScanner
              ? `${reading.angle_deg.toFixed(0)}° scan, ${Math.round(reading.quality * 100)}% quality`
              : `${Math.round(reading.quality * 100)}% quality`
            : "No trusted range";

          return (
            <div
              key={sensorId}
              className={`proximity-sensor-reading sensor-status-${status.toLowerCase()}`}
            >
              <div className="proximity-sensor-heading">
                <span className="proximity-sensor-dot" aria-hidden="true" />
                <strong>{SENSOR_LABELS[sensorId]}</strong>
                <small>{status}</small>
              </div>
              <div className="proximity-sensor-value">
                <strong>{available && reading ? `${reading.range_m.toFixed(2)} m` : "Unknown"}</strong>
                <span>{meta}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="proximity-key">
        <span><i className="key-sensor" />ToF return</span>
        <span><i className="key-low" />lower confidence</span>
      </div>
    </article>
  );
}
