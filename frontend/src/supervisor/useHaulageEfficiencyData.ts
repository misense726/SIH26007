import { useEffect, useState } from "react";
import { fetchTripHistory } from "../api/mineApi";
import type { DataMode, TripHistoryResponse } from "../types";
import { EFFICIENCY_REFRESH_MS } from "./haulEfficiency";
import { STATIC_DEMO } from "../simulation/demoMode";

export interface EfficiencyDataState {
  history: TripHistoryResponse | null;
  updatedAtMs: number | null;
  loading: boolean;
  error: boolean;
}

const EMPTY: EfficiencyDataState = { history: null, updatedAtMs: null, loading: true, error: false };
const IDLE: EfficiencyDataState = { history: null, updatedAtMs: null, loading: false, error: false };

export function useHaulageEfficiencyData(vehicleId: string, limit: number, mode?: DataMode): EfficiencyDataState {
  const requestKey = `${mode}:${vehicleId}:${limit}`;
  const [data, setData] = useState<EfficiencyDataState & { key: string }>({ ...EMPTY, key: "" });

  useEffect(() => {
    if (!vehicleId) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const history = await fetchTripHistory(limit, vehicleId, controller.signal);
        if (!controller.signal.aborted) {
          setData({ key: requestKey, history, updatedAtMs: Date.now(), loading: false, error: false });
        }
      } catch {
        if (!controller.signal.aborted) {
          setData((current) => ({
            ...(current.key === requestKey ? current : { ...EMPTY, key: requestKey }),
            loading: false,
            error: true,
          }));
        }
      } finally {
        inFlight = false;
      }
    };
    const initialTimer = window.setTimeout(load, 0);
    const refreshTimer = STATIC_DEMO ? null : window.setInterval(load, EFFICIENCY_REFRESH_MS);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
    };
  }, [vehicleId, limit, requestKey]);

  if (!vehicleId) return IDLE;
  return data.key === requestKey ? data : EMPTY;
}
