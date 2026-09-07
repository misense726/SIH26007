import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { MapFeature } from "../types";
import type { MineFrame, MineRenderer } from "./mineRenderer";

export function MineTerrainView({
  features,
  frame,
  controller,
  onSelect,
}: {
  features: MapFeature[];
  frame: MineFrame;
  controller: MutableRefObject<MineRenderer | null>;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(frame),
    select = useRef(onSelect);
  latest.current = frame;
  select.current = onSelect;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    let cancelled = false,
      active: MineRenderer | null = null;
    setStatus("loading");
    import("./mineRenderer")
      .then(({ createMineRenderer }) => {
        if (cancelled || !host.current) return;
        active = createMineRenderer(host.current, features, (id) =>
          select.current(id),
        );
        controller.current = active;
        active.update(latest.current);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      active?.dispose();
      controller.current = null;
    };
  }, [features, controller]);
  useEffect(() => {
    controller.current?.update(frame);
  }, [frame, controller]);
  return (
    <div
      className="mine-terrain-viewport"
      ref={host}
      role="img"
      aria-label="Angled mine map with detailed terrain, crusher and fleet traffic"
    >
      {status !== "ready" && (
        <div
          className="mine-terrain-status"
          role={status === "error" ? "alert" : "status"}
        >
          {status === "loading"
            ? "Loading mine terrain"
            : "3D rendering unavailable. Use the 2D plan or enable browser graphics acceleration."}
        </div>
      )}
      <div className="mine-terrain-help">
        Drag to orbit · Scroll to zoom · Right-drag to pan
      </div>
    </div>
  );
}
