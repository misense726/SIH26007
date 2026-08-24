import { useEffect, useRef, useState } from "react";
import { defaultWorldState } from "./defaultState";
import type { WorldState } from "../types";

export type ConnectionState = "CONNECTING" | "CONNECTED" | "DISCONNECTED";

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

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      setConnection("CONNECTING");
      socket = new WebSocket(websocketUrl());
      socket.onopen = () => setConnection("CONNECTED");
      socket.onmessage = (event) => {
        try {
          setWorld(JSON.parse(event.data) as WorldState);
        } catch {
          setConnection("DISCONNECTED");
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        setConnection("DISCONNECTED");
        retryTimer.current = window.setTimeout(connect, 1200);
      };
    };

    connect();
    return () => {
      disposed = true;
      socket?.close();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, []);

  return { world, connection };
}

