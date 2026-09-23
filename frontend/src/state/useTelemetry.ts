import { useEffect, useState } from "react";
import { defaultWorldState } from "./defaultState";
import { isWorldStateSnapshot } from "./worldStateSnapshot";
import { STATIC_DEMO } from "../simulation/demoMode";
import { createDemoPlayback } from "../simulation/demoPlayback";
import type { WorldState } from "../types";

export type ConnectionState = "CONNECTING" | "CONNECTED" | "DISCONNECTED";
export type DemoStatus = "Loading demo" | "Demo" | "Paused" | "Buffering demo";

const TELEMETRY_STALE_MS = 5000;
const FIRST_TELEMETRY_TIMEOUT_MS = 8000;

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/telemetry`;
}

export function useTelemetry(): {
  world: WorldState;
  connection: ConnectionState;
  demoStatus: DemoStatus;
  paused: boolean;
  togglePaused: () => void;
} {
  const [world, setWorld] = useState<WorldState>(defaultWorldState);
  const [connection, setConnection] = useState<ConnectionState>("CONNECTING");
  const [demoStatus, setDemoStatus] = useState<DemoStatus>("Loading demo");
  const [paused, setPaused] = useState(false);
  const [playback, setPlayback] = useState<ReturnType<typeof createDemoPlayback> | null>(null);

  useEffect(() => {
    if (!STATIC_DEMO) return;
    let receivedFrame = false;
    const player = createDemoPlayback({
      onWorld: (frame) => {
        receivedFrame = true;
        setWorld(frame);
      },
      onConnection: (next) => {
        setDemoStatus(next === "CONNECTED" ? "Demo" : "Buffering demo");
        setConnection(receivedFrame ? "CONNECTED" : next);
      },
    });
    setPlayback(player);
    return () => player.dispose();
  }, []);

  useEffect(() => {
    if (!playback) return;
    const update = () => {
      const active = !document.hidden && !paused;
      playback.setActive(active);
      if (!active) setDemoStatus("Paused");
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [playback, paused]);

  useEffect(() => {
    if (STATIC_DEMO) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = 1200;
    let mapKey = "";
    let referenceMap = defaultWorldState.reference_map;
    let lastDataMs = 0;

    const disconnect = () => {
      clearTimeout(retryTimer);
      clearTimeout(staleTimer);
      const previous = socket;
      socket = null;
      previous?.close();
    };

    const applyWorld = (nextWorld: WorldState) => {
      const nextRefMap = nextWorld.reference_map;
      const nextMapKey = nextRefMap ? `${nextRefMap.map_id}:${nextRefMap.created_at_ms}:${nextRefMap.features?.length}` : "";
      if (nextMapKey !== mapKey) {
        referenceMap = nextRefMap;
        mapKey = nextMapKey;
      }
      nextWorld.reference_map = referenceMap;
      lastDataMs = Date.now();
      setWorld(nextWorld);
      setConnection("CONNECTED");
    };

    // Immediately fetch the current world snapshot over HTTP so initial state renders instantly
    fetch("/api/world")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!disposed && data && isWorldStateSnapshot(data)) {
          applyWorld(data as WorldState);
        }
      })
      .catch(() => undefined);

    const connect = () => {
      if (disposed || socket) return;
      if (lastDataMs === 0) setConnection("CONNECTING");
      const current = new WebSocket(websocketUrl());
      socket = current;
      const armStaleTimer = (delayMs = TELEMETRY_STALE_MS) => {
        clearTimeout(staleTimer);
        staleTimer = setTimeout(() => {
          if (socket !== current) return;
          setConnection("DISCONNECTED");
          // Keep a quiet socket open. The next backend revision restores the UI
          // without requiring a page refresh when hardware telemetry resumes.
        }, delayMs);
      };
      armStaleTimer(FIRST_TELEMETRY_TIMEOUT_MS);
      current.onopen = () => {
        if (socket === current) armStaleTimer(FIRST_TELEMETRY_TIMEOUT_MS);
      };
      current.onmessage = (event) => {
        if (socket !== current || disposed) return;
        try {
          const nextWorld: unknown = JSON.parse(event.data);
          if (!isWorldStateSnapshot(nextWorld)) throw new Error("Invalid world-state snapshot");
          applyWorld(nextWorld as WorldState);
          retryMs = 1200;
          armStaleTimer();
        } catch {
          setConnection("DISCONNECTED");
          current.close();
        }
      };
      current.onerror = () => current.close();
      current.onclose = () => {
        if (socket !== current || disposed) return;
        socket = null;
        clearTimeout(staleTimer);
        const msSinceData = Date.now() - lastDataMs;
        if (lastDataMs > 0 && msSinceData < TELEMETRY_STALE_MS) {
          staleTimer = setTimeout(() => {
            if (!socket && !disposed) setConnection("DISCONNECTED");
          }, TELEMETRY_STALE_MS - msSinceData);
        } else {
          setConnection("DISCONNECTED");
        }
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 1.25, 2000);
      };
    };

    const visibilityChanged = () => {
      if (!disposed && !document.hidden && !socket) {
        connect();
      }
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    connect();
    return () => {
      disposed = true;
      disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);

  return { world, connection, demoStatus, paused, togglePaused: () => setPaused((value) => !value) };
}
