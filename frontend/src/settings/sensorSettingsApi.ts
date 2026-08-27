import type { RangeReading } from "../types";

export const SENSOR_IDS = [
  "front_scanner",
  "front_fixed",
  "rear_scanner",
  "left_side",
  "right_side",
] as const;

export type SensorId = (typeof SENSOR_IDS)[number];
export type ImuZeroStatus = "READY" | "ZEROING" | "ZEROED" | "ERROR";

export interface SensorDisplayPose {
  x_m: number;
  y_m: number;
  z_m: number;
  yaw_deg: number;
  pitch_deg: number;
}

export interface SensorDisplaySetting {
  sensor_id: SensorId;
  label: string;
  scanner: boolean;
  display_pose: SensorDisplayPose;
  alert_distance_m: number;
  visual_range_m: number;
}

export interface ImuZeroState {
  available: boolean;
  status: ImuZeroStatus;
  zeroed_at_ms: number | null;
  detail: string | null;
}

export interface SensorSettingsState {
  revision: number;
  imu_zero: ImuZeroState;
  sensors: SensorDisplaySetting[];
}

type RequestClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_SENSORS: SensorDisplaySetting[] = [
  {
    sensor_id: "front_scanner",
    label: "Front scanner",
    scanner: true,
    display_pose: { x_m: 0, y_m: 0.5, z_m: 0.28, yaw_deg: 0, pitch_deg: 0 },
    alert_distance_m: 0.8,
    visual_range_m: 4,
  },
  {
    sensor_id: "front_fixed",
    label: "Front fixed",
    scanner: false,
    display_pose: { x_m: 0, y_m: 0.48, z_m: 0.2, yaw_deg: 0, pitch_deg: 0 },
    alert_distance_m: 0.7,
    visual_range_m: 2,
  },
  {
    sensor_id: "rear_scanner",
    label: "Rear scanner",
    scanner: true,
    display_pose: { x_m: 0, y_m: -0.5, z_m: 0.28, yaw_deg: 180, pitch_deg: 0 },
    alert_distance_m: 0.7,
    visual_range_m: 4,
  },
  {
    sensor_id: "left_side",
    label: "Left fixed",
    scanner: false,
    display_pose: { x_m: -0.32, y_m: 0, z_m: 0.2, yaw_deg: -90, pitch_deg: 0 },
    alert_distance_m: 0.55,
    visual_range_m: 2,
  },
  {
    sensor_id: "right_side",
    label: "Right fixed",
    scanner: false,
    display_pose: { x_m: 0.32, y_m: 0, z_m: 0.2, yaw_deg: 90, pitch_deg: 0 },
    alert_distance_m: 0.55,
    visual_range_m: 2,
  },
];

export function defaultSensorSettings(): SensorSettingsState {
  return {
    revision: 0,
    imu_zero: {
      available: false,
      status: "READY",
      zeroed_at_ms: null,
      detail: "Connect MAIN to zero the IMU.",
    },
    sensors: DEFAULT_SENSORS.map((sensor) => ({
      ...sensor,
      display_pose: { ...sensor.display_pose },
    })),
  };
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the HTTP status when the server does not return JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function loadSensorSettings(
  request: RequestClient = fetch,
): Promise<SensorSettingsState> {
  return readJson<SensorSettingsState>(await request("/api/sensor-settings"));
}

export async function saveSensorSetting(
  setting: SensorDisplaySetting,
  request: RequestClient = fetch,
): Promise<SensorDisplaySetting> {
  return readJson<SensorDisplaySetting>(
    await request(`/api/sensor-settings/${setting.sensor_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_pose: setting.display_pose,
        alert_distance_m: setting.alert_distance_m,
        visual_range_m: setting.visual_range_m,
      }),
    }),
  );
}

export async function zeroImu(request: RequestClient = fetch): Promise<ImuZeroState> {
  return readJson<ImuZeroState>(
    await request("/api/imu/zero", { method: "POST" }),
  );
}

export function settingForReading(
  settings: SensorDisplaySetting[],
  reading: RangeReading,
): SensorDisplaySetting | undefined {
  return settings.find((setting) => setting.sensor_id === reading.sensor_id);
}
