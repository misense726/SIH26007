import { useEffect, useState } from "react";
import {
  defaultSensorSettings,
  loadSensorSettings,
  saveSensorSetting,
  zeroImu,
  type SensorDisplaySetting,
  type SensorId,
  type SensorSettingsState,
} from "./sensorSettingsApi";

export type SettingsConnection = "LOADING" | "SAVED" | "LOCAL_ONLY" | "ERROR";

export function useSensorSettings(): {
  settings: SensorSettingsState;
  connection: SettingsConnection;
  message: string | null;
  updateSensor: (sensorId: SensorId, setting: SensorDisplaySetting) => void;
  saveSensor: (sensorId: SensorId) => Promise<void>;
  zeroImuNow: () => Promise<void>;
} {
  const [settings, setSettings] = useState<SensorSettingsState>(() => defaultSensorSettings());
  const [connection, setConnection] = useState<SettingsConnection>("LOADING");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    loadSensorSettings()
      .then((loaded) => {
        if (disposed) return;
        setSettings(loaded);
        setConnection("SAVED");
      })
      .catch(() => {
        if (disposed) return;
        setConnection("LOCAL_ONLY");
        setMessage("Calibration unavailable. Display defaults are active.");
      });
    return () => {
      disposed = true;
    };
  }, []);

  function updateSensor(sensorId: SensorId, setting: SensorDisplaySetting) {
    setSettings((current) => ({
      ...current,
      sensors: current.sensors.map((sensor) =>
        sensor.sensor_id === sensorId ? setting : sensor,
      ),
    }));
  }

  async function saveSensor(sensorId: SensorId) {
    const setting = settings.sensors.find((sensor) => sensor.sensor_id === sensorId);
    if (!setting) return;
    setMessage("Saving display settings...");
    try {
      const saved = await saveSensorSetting(setting);
      setSettings((current) => ({
        ...current,
        sensors: current.sensors.map((sensor) =>
          sensor.sensor_id === sensorId ? saved : sensor,
        ),
      }));
      setConnection("SAVED");
      setMessage(`${saved.label} saved.`);
    } catch (error) {
      setConnection("ERROR");
      setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }

  async function zeroImuNow() {
    setSettings((current) => ({
      ...current,
      imu_zero: { ...current.imu_zero, status: "ZEROING", detail: "Keep the vehicle still." },
    }));
    try {
      const imuZero = await zeroImu();
      setSettings((current) => ({ ...current, imu_zero: imuZero }));
      setConnection("SAVED");
      setMessage(imuZero.detail ?? "IMU zero stored.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "IMU zero failed.";
      setSettings((current) => ({
        ...current,
        imu_zero: { ...current.imu_zero, status: "ERROR", detail },
      }));
      setConnection("ERROR");
      setMessage(detail);
    }
  }

  return { settings, connection, message, updateSensor, saveSensor, zeroImuNow };
}
