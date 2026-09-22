import { useEffect, useMemo, useRef } from "react";
import type { VehiclePose, WorldState } from "../types";
import { buildLidarFrame } from "./lidarFrame";
import { createLidarRenderer, type LidarRenderer } from "./lidarRenderer";

interface LidarPointCloudProps {
  world: WorldState;
  vehicle: VehiclePose;
  className?: string;
}

export function LidarPointCloud({
  world,
  vehicle,
  className = "",
}: LidarPointCloudProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LidarRenderer | null>(null);
  const frame = useMemo(() => buildLidarFrame(world, vehicle), [world, vehicle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = createLidarRenderer(container);
    rendererRef.current = renderer;
    renderer.update(frame);
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update(frame);
  }, [frame]);

  return (
    <div
      ref={containerRef}
      className={`lidar-point-cloud ${className}`}
      role="img"
      aria-label={`Vehicle-centered LiDAR view with ${frame.returnCount} mapped returns and ${frame.entities.length} tracked objects`}
    />
  );
}
