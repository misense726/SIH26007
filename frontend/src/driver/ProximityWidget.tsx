import type { RangeReading, SensorHealth, SpatialPoint, VehiclePose } from "../types";
import { isUsableRangeReading } from "../state/rangeReadings";
import { TOF_SENSOR_IDS } from "../state/selectors";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import { getSensorThreatLevel } from "../spatial/spatialProjection";
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
  const length = 18 * Math.max(0.2, Math.cos(pitchRadians));
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
  const readingById = new Map(readings.map((r) => [r.sensor_id, r]));

  // Check alert states
  const sensorAlerts = sensors.map((sensor) => {
    const reading = readingById.get(sensor.sensor_id);
    const threat = getSensorThreatLevel(reading, sensor);
    return { sensor, reading, threat, isAlert: threat === "ALERT", isCaution: threat === "CAUTION" };
  });

  const isFrontAlert = sensorAlerts.some(
    (sa) => (sa.sensor.sensor_id === "front_scanner" || sa.sensor.sensor_id === "front_fixed") && sa.isAlert,
  );
  const isRearAlert = sensorAlerts.some((sa) => sa.sensor.sensor_id === "rear_scanner" && sa.isAlert);
  const isLeftAlert = sensorAlerts.some((sa) => sa.sensor.sensor_id === "left_side" && sa.isAlert);
  const isRightAlert = sensorAlerts.some((sa) => sa.sensor.sensor_id === "right_side" && sa.isAlert);

  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      role="img"
      aria-label={label ?? `Vehicle-centred ToF view with ${points.length} mapped returns`}
    >
      <defs>
        {/* Dynamic Sector Alert Gradients */}
        <radialGradient id="prox-alert-gradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.45" />
          <stop offset="80%" stopColor="#ef4444" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="prox-hit-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#ef4444" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 1. Distance Range Bands (4m, 2.8m, 1.6m) */}
      <circle className="proximity-band" cx="120" cy="120" r="91" />
      <circle className="proximity-band" cx="120" cy="120" r="62" />
      <circle className="proximity-band proximity-band-near" cx="120" cy="120" r="35" />
      <path className="proximity-axis" d="M120 20V220M20 120H220" />

      {/* Range ring distance labels */}
      <text x="124" y="32" className="prox-ring-label">4.0m</text>
      <text x="124" y="61" className="prox-ring-label">2.8m</text>
      <text x="124" y="88" className="prox-ring-label">1.6m</text>

      {/* 2. Dynamic Red Hazard Sectors when proximity threshold breached */}
      {isFrontAlert && (
        <path
          d="M 120 120 L 70 30 A 100 100 0 0 1 170 30 Z"
          fill="url(#prox-alert-gradient)"
          stroke="#ef4444"
          strokeWidth="1.6"
          strokeDasharray="4 3"
          className="prox-danger-sector pulse-danger-fast"
        />
      )}
      {isRearAlert && (
        <path
          d="M 120 120 L 70 210 A 100 100 0 0 0 170 210 Z"
          fill="url(#prox-alert-gradient)"
          stroke="#ef4444"
          strokeWidth="1.6"
          strokeDasharray="4 3"
          className="prox-danger-sector pulse-danger-fast"
        />
      )}
      {isLeftAlert && (
        <path
          d="M 120 120 L 30 70 A 100 100 0 0 0 30 170 Z"
          fill="url(#prox-alert-gradient)"
          stroke="#ef4444"
          strokeWidth="1.6"
          strokeDasharray="4 3"
          className="prox-danger-sector pulse-danger-fast"
        />
      )}
      {isRightAlert && (
        <path
          d="M 120 120 L 210 70 A 100 100 0 0 1 210 170 Z"
          fill="url(#prox-alert-gradient)"
          stroke="#ef4444"
          strokeWidth="1.6"
          strokeDasharray="4 3"
          className="prox-danger-sector pulse-danger-fast"
        />
      )}

      {/* 3. Mapped 2D/2.5D Point Cloud with Optical Perspective Scaling */}
      {points.map((point, index) => {
        const endpoint = spatialPointToPlot(point, vehicle);
        const dist = endpoint.distance_m;
        // Nearer objects are realistically larger
        const pointRadius = Math.min(11, Math.max(3.2, 9.5 / (dist + 0.35)));
        const isNearDanger = dist <= 1.0;

        return (
          <g key={`${point.source_sensor_id}-${point.timestamp_ms}-${index}`}>
            {isNearDanger && (
              <circle
                cx={endpoint.x}
                cy={endpoint.y}
                r={pointRadius * 1.7}
                fill="none"
                stroke="#ef4444"
                strokeWidth="1.4"
                className="point-danger-ripple"
              />
            )}
            <circle
              className={`range-hit ${isNearDanger ? "range-hit-alert" : ""} ${point.quality < 0.65 ? "range-hit-low" : ""}`}
              cx={endpoint.x}
              cy={endpoint.y}
              r={pointRadius}
            >
              <title>
                {`${displayName(point.source_sensor_id)} return: ${dist.toFixed(2)} m from vehicle`}
              </title>
            </circle>
          </g>
        );
      })}

      {/* 4. Top-Down Heavy Haul Truck Model */}
      <g className="vehicle-glyph" aria-label="Haul Truck Top View">
        {/* Ground shadow beneath truck */}
        <rect x="98" y="86" width="44" height="68" rx="8" fill="rgba(0, 0, 0, 0.45)" />

        {/* 6 Rugged Mining Wheels */}
        {/* Front Left / Right */}
        <rect x="99" y="93" width="7" height="15" rx="2" fill="#090d14" stroke="#334155" strokeWidth="0.8" />
        <rect x="134" y="93" width="7" height="15" rx="2" fill="#090d14" stroke="#334155" strokeWidth="0.8" />
        {/* Rear Dual Axles */}
        <rect x="98" y="126" width="8" height="18" rx="2" fill="#090d14" stroke="#334155" strokeWidth="0.8" />
        <rect x="134" y="126" width="8" height="18" rx="2" fill="#090d14" stroke="#334155" strokeWidth="0.8" />

        {/* Steel Chassis Base */}
        <rect x="103" y="89" width="34" height="62" rx="5" fill="#0f172a" stroke="#475569" strokeWidth="1.2" />

        {/* Dump Bed (Rear Section) */}
        <rect x="104" y="112" width="32" height="38" rx="3" fill="#1e293b" stroke="#475569" strokeWidth="1.2" />
        {/* Dump Bed Canopy extending forward */}
        <path d="M 104 112 L 106 99 L 134 99 L 136 112 Z" fill="#334155" stroke="#475569" strokeWidth="1" />
        {/* Tailgate Chevrons */}
        <line x1="106" y1="148" x2="134" y2="148" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2" />

        {/* Cab Assembly (Front Offset) */}
        <rect x="106" y="94" width="18" height="16" rx="3" fill="#0284c7" stroke="#38bdf8" strokeWidth="1.2" />
        {/* Windshield */}
        <rect x="108" y="95" width="14" height="6" rx="1.5" fill="#bae6fd" fillOpacity="0.85" />

        {/* Directional Front Pointer Arrow */}
        <path d="M 120 82 L 127 92 L 113 92 Z" fill="var(--accent, #38bdf8)" />

        {/* Roof Safety Beacon */}
        <circle
          cx="115"
          cy="102"
          r="2.5"
          fill={isFrontAlert || isRearAlert || isLeftAlert || isRightAlert ? "#ef4444" : "#f59e0b"}
        />

        {/* Headlight Lamps */}
        <circle cx="106" cy="89" r="1.8" fill="#ffffff" />
        <circle cx="134" cy="89" r="1.8" fill="#ffffff" />

        {/* Vehicle Center Pivot */}
        <circle cx="120" cy="120" r="3.2" fill="#38bdf8" stroke="#ffffff" strokeWidth="1" />
      </g>

      {/* 5. ToF Sensor Markers & Turrets */}
      <g className="tof-sensor-layout" aria-label="Configured ToF sensor positions">
        {sensors.map((sensor) => {
          const origin = sensorPlotOrigin(sensor);
          const reading = latestReading(readings, sensor.sensor_id);
          const endpoint = sensorPlotDirection(sensor, reading);
          const pitch = sensor.display_pose.pitch_deg;
          const sensorCls = `sensor-${sensor.sensor_id.replaceAll("_", "-")}`;
          const threat = getSensorThreatLevel(reading, sensor);
          const isAlert = threat === "ALERT";

          return (
            <g
              key={sensor.sensor_id}
              className={`tof-sensor-marker ${sensorCls} ${isAlert ? "sensor-marker-alert" : ""} ${
                pitch < -5 ? "tof-sensor-marker-down" : ""
              }`}
            >
              <line
                className={`tof-sensor-direction ${isAlert ? "direction-alert" : ""}`}
                x1={origin.x}
                y1={origin.y}
                x2={endpoint.x}
                y2={endpoint.y}
                stroke={isAlert ? "#ef4444" : undefined}
                strokeWidth={isAlert ? "2.5" : "1.6"}
              />
              <circle
                className={`tof-sensor-origin ${isAlert ? "origin-alert" : ""}`}
                cx={origin.x}
                cy={origin.y}
                r={sensor.scanner ? 5 : 4}
                fill={isAlert ? "#ef4444" : undefined}
              />
              {pitch < -5 && <circle className="tof-sensor-down-point" cx={endpoint.x} cy={endpoint.y} r="2" />}
              <title>
                {`${sensor.label}: ${sensor.scanner ? "servo head" : "fixed"}, ${sensor.display_pose.pitch_deg.toFixed(0)}° pitch${
                  reading?.is_valid ? ` (${reading.range_m.toFixed(2)} m)` : ""
                }`}
              </title>
            </g>
          );
        })}
      </g>

      <text x="120" y="13" textAnchor="middle" className="prox-front-heading">FRONT</text>
    </svg>
  );
}

interface ProximityWidgetProps {
  points: SpatialPoint[];
  vehicle: VehiclePose;
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

export interface ProximityAlert {
  sensor: SensorDisplaySetting;
  reading: RangeReading;
}

export function activeProximityAlerts(
  readings: RangeReading[],
  sensors: SensorDisplaySetting[],
): ProximityAlert[] {
  return sensors
    .map((sensor) => ({
      sensor,
      reading: latestReading(readings, sensor.sensor_id),
    }))
    .filter((candidate): candidate is ProximityAlert =>
      candidate.reading !== undefined &&
      getSensorThreatLevel(candidate.reading, candidate.sensor) === "ALERT"
    )
    .sort((left, right) => left.reading.range_m - right.reading.range_m);
}

export function ProximityWidget({
  points,
  vehicle,
  readings,
  sensorHealth,
  sensorSettings,
  telemetryConnected,
}: ProximityWidgetProps) {
  const healthBySensor = new Map(
    sensorHealth.map((sensor) => [sensor.sensor_id, sensor]),
  );

  const settingById = new Map(sensorSettings.map((s) => [s.sensor_id, s]));
  const trustedReadings = telemetryConnected
    ? readings.filter((reading) => {
        const status = healthBySensor.get(reading.sensor_id)?.status;
        return (
          (status === "HEALTHY" || status === "DEGRADED") &&
          isUsableRangeReading(reading)
        );
      })
    : [];
  const trustedSensorIds = new Set(
    trustedReadings.map((reading) => reading.sensor_id),
  );
  const trustedReadingCount = trustedSensorIds.size;
  const trustedPoints = telemetryConnected
    ? points.filter((point) => trustedSensorIds.has(point.source_sensor_id))
    : [];
  const proximityAlerts = activeProximityAlerts(trustedReadings, sensorSettings);
  const nearestAlert = proximityAlerts[0];

  return (
    <article className="proximity-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Proximity</p>
          <h2>Range field</h2>
        </div>
        <span className="source-badge">ToF · 2.5D</span>
      </div>

      {nearestAlert && (
        <div className="proximity-alert" role="alert" aria-live="assertive">
          <strong>PROXIMITY ALERT</strong>
          <span>{nearestAlert.sensor.label}: {nearestAlert.reading.range_m.toFixed(2)} m</span>
        </div>
      )}

      <TofRangePlot
        points={trustedPoints}
        vehicle={vehicle}
        sensors={sensorSettings}
        readings={trustedReadings}
        label={`Vehicle-centred ToF view with ${trustedPoints.length} mapped returns`}
      />

      {trustedPoints.length === 0 && (
        <p className="proximity-empty">
          {trustedReadingCount > 0
            ? "No mapped returns"
            : "No trusted ranges"}
        </p>
      )}

      <details className="proximity-sensor-details">
        <summary>
          <span>Sensor detail</span>
          <strong>{trustedReadingCount}/{TOF_SENSOR_IDS.length} trusted</strong>
        </summary>
        <div className="proximity-sensor-grid" aria-label="Live ToF sensor readings">
          {TOF_SENSOR_IDS.map((sensorId) => {
            const health = healthBySensor.get(sensorId);
            const setting = settingById.get(sensorId);
            const status = telemetryConnected ? health?.status ?? "OFFLINE" : "OFFLINE";
            const reading = latestReading(trustedReadings, sensorId);
            const available =
              telemetryConnected &&
              (status === "HEALTHY" || status === "DEGRADED") &&
              Boolean(reading && isUsableRangeReading(reading));
            const isScanner = sensorId === "front_scanner" || sensorId === "rear_scanner";
            const threat = setting ? getSensorThreatLevel(reading, setting) : "UNKNOWN";
            const isAlert = available && threat === "ALERT";
            const isCaution = available && threat === "CAUTION";

            const meta = available && reading
              ? isScanner
                ? `${reading.angle_deg.toFixed(0)}° scan, ${Math.round(reading.quality * 100)}% quality`
                : `${Math.round(reading.quality * 100)}% quality`
              : "No trusted range";

            const rangeM = available && reading ? reading.range_m : null;
            const maxRange = setting?.visual_range_m ?? 4;
            const alertDist = setting?.alert_distance_m ?? 1;
            const gaugePct = rangeM !== null ? Math.max(5, Math.min(100, (rangeM / maxRange) * 100)) : 0;

            return (
              <div
                key={sensorId}
                className={`proximity-sensor-reading sensor-status-${status.toLowerCase()} ${
                  isAlert ? "sensor-card-alert" : isCaution ? "sensor-card-caution" : ""
                }`}
              >
                <div className="proximity-sensor-heading">
                  <span className={`proximity-sensor-dot ${isAlert ? "pulse-danger-fast" : ""}`} aria-hidden="true" />
                  <strong>{SENSOR_LABELS[sensorId]}</strong>
                  <small>{status}</small>
                </div>

                {available && rangeM !== null && (
                  <div className="prox-mini-gauge" title={`Distance: ${rangeM.toFixed(2)}m`}>
                    <div
                      className={`prox-gauge-bar ${isAlert ? "bar-alert" : isCaution ? "bar-caution" : "bar-clear"}`}
                      style={{ width: `${gaugePct}%` }}
                    />
                    <div
                      className="prox-gauge-alert-line"
                      style={{ left: `${Math.min(95, (alertDist / maxRange) * 100)}%` }}
                    />
                  </div>
                )}

                <div className="proximity-sensor-value">
                  <strong className={isAlert ? "text-danger" : isCaution ? "text-warning" : ""}>
                    {available && reading ? `${reading.range_m.toFixed(2)} m` : "Unknown"}
                  </strong>
                  <span>{meta}</span>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      <div className="proximity-key">
        <span><i className="key-sensor" />ToF return</span>
        <span><i className="key-danger" />Hazard</span>
        <span><i className="key-low" />Low confidence</span>
      </div>
    </article>
  );
}
