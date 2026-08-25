import { useEffect, useRef, useState } from "react";
import { defaultWorldState } from "./defaultState";
import type { WorldState } from "../types";

export type ConnectionState = "CONNECTING" | "CONNECTED" | "DISCONNECTED";

const TELEMETRY_STALE_MS = 750;
const FIRST_TELEMETRY_TIMEOUT_MS = 3000;

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/telemetry`;
}

export function useTelemetry(): {
  world: WorldState;
  connection: ConnectionState;
} {
  const [world, setWorld] = useState<WorldState>(defaultWorldState);
  const [connection, setConnection] = useState<ConnectionState>("CONNECTING");
  const retryTimer = useRef<number | null>(null);
  const staleTimer = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;

    const clearStaleTimer = () => {
      if (staleTimer.current !== null) {
        window.clearTimeout(staleTimer.current);
        staleTimer.current = null;
      }
    };

    const armStaleTimer = (delayMs = TELEMETRY_STALE_MS) => {
      clearStaleTimer();
      staleTimer.current = window.setTimeout(() => {
        if (disposed) return;
        setConnection("DISCONNECTED");
        socket?.close();
      }, delayMs);
    };

    const connect = () => {
      if (disposed) return;
      clearStaleTimer();
      setConnection("CONNECTING");
      socket = new WebSocket(websocketUrl());
      armStaleTimer(FIRST_TELEMETRY_TIMEOUT_MS);
      socket.onopen = () => armStaleTimer(FIRST_TELEMETRY_TIMEOUT_MS);
      socket.onmessage = (event) => {
        try {
          setWorld(JSON.parse(event.data) as WorldState);
          setConnection("CONNECTED");
          armStaleTimer();
        } catch {
          setConnection("DISCONNECTED");
          socket?.close();
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        clearStaleTimer();
        setConnection("DISCONNECTED");
        retryTimer.current = window.setTimeout(connect, 1200);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearStaleTimer();
      socket?.close();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, []);

  return { world, connection };
}
