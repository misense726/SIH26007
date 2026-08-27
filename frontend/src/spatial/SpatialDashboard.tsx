import { availableRangeReadings } from "../state/rangeReadings";
import { availableSpatialPoints } from "../state/spatialPoints";
import { formatNumber, primaryVehicle } from "../state/selectors";
import type { ConnectionState } from "../state/useTelemetry";
import type { SensorDisplaySetting } from "../settings/sensorSettingsApi";
import type { SpatialPoint, WorldState } from "../types";
import {
  pointDistanceFromSensor,
  projectVehiclePoint,
  rangeEndpoint,
  worldPointToVehicle,
  type VehiclePoint3D,
} from "./spatialProjection";

interface SpatialDashboardProps {
  world: WorldState;
  connection: ConnectionState;
  sensorSettings: SensorDisplaySetting[];
}

interface DisplayPoint {
  source: SensorDisplaySetting;
  point: VehiclePoint3D;
  spatialPoint: SpatialPoint;
  distanceM: number;
}

function displayPoints(
  points: SpatialPoint[],
  world: WorldState,
  sensors: SensorDisplaySetting[],
): DisplayPoint[] {
  const vehicle = primaryVehicle(world);
  const settingsById = new Map<string, SensorDisplaySetting>(
    sensors.map((sensor) => [sensor.sensor_id, sensor]),
  );
  return points.flatMap((spatialPoint) => {
    const source = settingsById.get(spatialPoint.source_sensor_id);
    if (!source) return [];
    const point = worldPointToVehicle(spatialPoint, vehicle);
    const distanceM = pointDistanceFromSensor(point, source);
    if (distanceM > source.visual_range_m) return [];
    return [{ source, point, spatialPoint, distanceM }];
  }).slice(-180);
}

function floorGrid() {
  const longitudinal = Array.from({ length: 9 }, (_, index) => -4 + index);
  const lateral = Array.from({ length: 11 }, (_, index) => -5 + index);
  return (
    <g className="spatial-floor-grid" aria-hidden="true">
      {longitudinal.map((x) => {
        const near = projectVehiclePoint({ x_m: x, y_m: -3.5, z_m: 0 });
        const far = projectVehiclePoint({ x_m: x, y_m: 6, z_m: 0 });
        return <line key={`x-${x}`} x1={near.x} y1={near.y} x2={far.x} y2={far.y} />;
      })}
      {lateral.map((y) => {
        const left = projectVehiclePoint({ x_m: -4, y_m: y, z_m: 0 });
        const right = projectVehiclePoint({ x_m: 4, y_m: y, z_m: 0 });
        return <line key={`y-${y}`} x1={left.x} y1={left.y} x2={right.x} y2={right.y} />;
      })}
    </g>
  );
}

function sensorClass(sensorId: string): string {
  return `sensor-${sensorId.replaceAll("_", "-")}`;
}

export function SpatialDashboard({ world, connection, sensorSettings }: SpatialDashboardProps) {
  const connected = connection === "CONNECTED";
  const vehicle = primaryVehicle(world);
  const maxVisualRange = Math.max(4, ...sensorSettings.map((sensor) => sensor.visual_range_m));
  const ranges = availableRangeReadings(world.ranges, world.sensor_health, connected);
  const points = availableSpatialPoints(
    world.spatial_points,
    world.sensor_health,
    connected,
    world.generated_at_ms,
    vehicle,
    maxVisualRange,
  );
  const plottedPoints = displayPoints(points, world, sensorSettings);
  const readingById = new Map(ranges.map((reading) => [reading.sensor_id, reading]));
  const latestReadingById = new Map(
    (connected ? world.ranges : []).map((reading) => [reading.sensor_id, reading]),
  );
  const closestAlert = sensorSettings
    .map((sensor) => {
      const reading = readingById.get(sensor.sensor_id);
      return reading && reading.range_m <= sensor.alert_distance_m
        ? { sensor, rangeM: reading.range_m }
        : null;
    })
    .filter((alert): alert is { sensor: SensorDisplaySetting; rangeM: number } => alert !== null)
    .sort((left, right) => left.rangeM - right.rangeM)[0];

  return (
    <section className="dashboard spatial-dashboard" aria-label="Live 2.5D ToF surrounding view">
      <header className="page-heading spatial-page-heading">
        <div>
          <p className="eyebrow">Live surrounding reconstruction</p>
          <h2>Spatial view</h2>
          <p>Five ToF sensors shown in the vehicle frame.</p>
        </div>
        <div className="spatial-heading-badges">
          <span className="source-badge">2.5D ToF</span>
          <span className={`source-badge ${connected ? "source-live" : "source-offline"}`}>
            {connected ? world.mode : connection}
          </span>
        </div>
      </header>

      {closestAlert && (
        <div className="spatial-alert" role="alert">
          <strong>{closestAlert.sensor.label}</strong>
          <span>{closestAlert.rangeM.toFixed(2)} m inside its {closestAlert.sensor.alert_distance_m.toFixed(2)} m display alert.</span>
        </div>
      )}

      <div className="spatial-layout">
        <article className="spatial-scene-card">
          <svg
            className="spatial-scene"
            viewBox="0 0 1000 620"
            role="img"
            aria-label={`2.5D ToF display with ${plottedPoints.length} mapped returns and ${ranges.length} valid live ranges`}
          >
            <defs>
              <linearGradient id="spatial-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="spatial-sky-top" />
                <stop offset="1" className="spatial-sky-bottom" />
              </linearGradient>
              <radialGradient id="spatial-floor" cx="50%" cy="20%" r="85%">
                <stop offset="0" className="spatial-floor-near" />
                <stop offset="1" className="spatial-floor-far" />
              </radialGradient>
              <filter id="point-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2.4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <rect width="1000" height="620" rx="18" fill="url(#spatial-sky)" />
            <path d="M0 248H1000V620H0Z" fill="url(#spatial-floor)" />
            <line className="spatial-horizon" x1="0" y1="248" x2="1000" y2="248" />
            {floorGrid()}

            <g className="spatial-beams">
              {sensorSettings.map((sensor) => {
                const reading = readingById.get(sensor.sensor_id);
                const latestReading = latestReadingById.get(sensor.sensor_id);
                const origin = projectVehiclePoint(sensor.display_pose);
                const endpoint = projectVehiclePoint(
                  rangeEndpoint(sensor, sensor.scanner ? latestReading : reading),
                );
                const isAlert = Boolean(reading && reading.range_m <= sensor.alert_distance_m);
                return (
                  <g key={sensor.sensor_id} className={`${sensorClass(sensor.sensor_id)} ${isAlert ? "beam-alert" : ""}`}>
                    <line
                      className={`sensor-beam ${reading ? "sensor-beam-live" : "sensor-beam-unknown"}`}
                      x1={origin.x}
                      y1={origin.y}
                      x2={endpoint.x}
                      y2={endpoint.y}
                    />
                    {reading && <circle className="beam-hit" cx={endpoint.x} cy={endpoint.y} r="6" />}
                  </g>
                );
              })}
            </g>

            <g className="spatial-point-cloud" filter="url(#point-glow)">
              {plottedPoints.flatMap(({ source, point, spatialPoint, distanceM }, index) => {
                const height = Math.max(0.12, Math.min(1.1, point.z_m));
                const heights = [0.05, height * 0.52, height];
                const alert = distanceM <= source.alert_distance_m;
                return heights.map((z, layer) => {
                  const screen = projectVehiclePoint({ ...point, z_m: z });
                  return (
                    <circle
                      key={`${spatialPoint.source_sensor_id}-${spatialPoint.timestamp_ms}-${index}-${layer}`}
                      className={`spatial-dot ${sensorClass(source.sensor_id)} ${alert ? "spatial-dot-alert" : ""} ${spatialPoint.quality < 0.65 ? "spatial-dot-low" : ""}`}
                      cx={screen.x}
                      cy={screen.y}
                      r={Math.max(1.5, 3.1 * screen.scale)}
                    >
                      <title>{`${source.label}: ${distanceM.toFixed(2)} m`}</title>
                    </circle>
                  );
                });
              })}
            </g>

            <g className="spatial-vehicle">
              <path d="M455 500L470 392Q500 363 530 392L545 500Q500 538 455 500Z" />
              <path className="spatial-vehicle-front" d="M482 382h36l-18-25z" />
              <line x1="469" y1="430" x2="531" y2="430" />
              <line x1="463" y1="470" x2="537" y2="470" />
            </g>

            <g className="spatial-sensor-heads">
              {sensorSettings.map((sensor) => {
                const reading = readingById.get(sensor.sensor_id);
                const latestReading = latestReadingById.get(sensor.sensor_id);
                const origin = projectVehiclePoint(sensor.display_pose);
                const endpoint = projectVehiclePoint(
                  rangeEndpoint(sensor, sensor.scanner ? latestReading : reading),
                );
                const angle = sensor.display_pose.yaw_deg
                  + (sensor.scanner ? latestReading?.angle_deg ?? 0 : 0);
                return (
                  <g key={sensor.sensor_id} className={sensorClass(sensor.sensor_id)}>
                    <circle cx={origin.x} cy={origin.y} r={sensor.scanner ? 7 : 5} />
                    <line className="sensor-head-direction" x1={origin.x} y1={origin.y} x2={endpoint.x} y2={endpoint.y} />
                    <title>{`${sensor.label}${sensor.scanner ? ` head ${angle.toFixed(0)}°` : ""}`}</title>
                  </g>
                );
              })}
            </g>

            <text className="spatial-front-label" x="500" y="42" textAnchor="middle">FRONT</text>
          </svg>

          {!connected && (
            <div className="spatial-empty-overlay">
              <strong>{connection === "CONNECTING" ? "Connecting to telemetry" : "Telemetry unavailable"}</strong>
              <span>Live dots and sensor heads will appear when MAIN is connected.</span>
            </div>
          )}

          <div className="spatial-legend">
            <span><i className="legend-dot-live" />Mapped return</span>
            <span><i className="legend-line-beam" />Current beam</span>
            <span><i className="legend-dot-alert" />Display alert</span>
          </div>
          <p className="spatial-truth-note">Dot height is a display hint, not measured elevation.</p>
        </article>

        <aside className="spatial-sensor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Current inputs</p>
              <h3>Sensor heads</h3>
            </div>
            <span className="source-badge">{ranges.length}/5 valid</span>
          </div>
          <div className="spatial-sensor-list">
            {sensorSettings.map((sensor) => {
              const reading = readingById.get(sensor.sensor_id);
              const latestReading = latestReadingById.get(sensor.sensor_id);
              const health = world.sensor_health.find((item) => item.sensor_id === sensor.sensor_id);
              const alert = Boolean(reading && reading.range_m <= sensor.alert_distance_m);
              return (
                <article key={sensor.sensor_id} className={`spatial-sensor-row ${alert ? "spatial-sensor-row-alert" : ""}`}>
                  <span className={`sensor-swatch ${sensorClass(sensor.sensor_id)}`} />
                  <div>
                    <strong>{sensor.label}</strong>
                    <small>{health?.status ?? "OFFLINE"}</small>
                  </div>
                  <div className="spatial-range-value">
                    <strong>{reading ? `${formatNumber(reading.range_m, 2)} m` : "Unknown"}</strong>
                    <small>{sensor.scanner ? `${formatNumber(latestReading?.angle_deg ?? Number.NaN, 0)}° head` : `${formatNumber(sensor.display_pose.yaw_deg, 0)}° fixed`}</small>
                  </div>
                </article>
              );
            })}
          </div>
          <dl className="spatial-summary-list">
            <div><dt>Mapped dots</dt><dd>{plottedPoints.length}</dd></div>
            <div><dt>Heading</dt><dd>{connected ? `${formatNumber(vehicle.heading_deg, 0)}°` : "--"}</dd></div>
            <div><dt>IMU yaw</dt><dd>{connected ? `${formatNumber(world.motion.imu_heading_deg, 0)}°` : "--"}</dd></div>
            <div><dt>IMU zero</dt><dd>Settings</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
