import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { MapFeature } from "../types";
import { createMineRenderer, type MineFrame, type MineRenderer } from "./mineRenderer";

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
    select = useRef(onSelect),
    featuresRef = useRef(features);
  latest.current = frame;
  select.current = onSelect;
  featuresRef.current = features;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const featuresKey = useMemo(() => {
    if (!features || features.length === 0) return "empty";
    return `${features.length}:${features[0].feature_id}:${features[features.length - 1].feature_id}`;
  }, [features]);

  useEffect(() => {
    if (!host.current) return;
    try {
      const active = createMineRenderer(host.current, featuresRef.current, (id) =>
        select.current(id),
      );
      controller.current = active;
      active.update(latest.current);
      setStatus("ready");
      return () => {
        active.dispose();
        controller.current = null;
      };
    } catch (err) {
      console.error("MineRenderer initialization error:", err);
      setStatus("error");
    }
  }, [featuresKey, controller]);
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
