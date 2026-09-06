import { memo } from "react";
import type { MapFeature, Point2D } from "../types";

export const MineCartography = memo(function MineCartography({
  features,
  project,
  unit = 1,
  raised = false,
  showRoute = true,
}: {
  features: MapFeature[];
  project: (p: Point2D) => [number, number];
  unit?: number;
  raised?: boolean;
  showRoute?: boolean;
}) {
  const ordered = [...features].sort(
    (a, b) =>
      Number(b.properties.cartography === "contour") -
      Number(a.properties.cartography === "contour"),
  );
  return (
    <g aria-label="Mine terrain and infrastructure">
      {ordered.map((f) => {
        const points = f.points
          .map(project)
          .map((p) => p.join(","))
          .join(" ");
        const cartography = f.properties.cartography;
        if (f.geometry_type === "POLYGON") {
          const fill =
            typeof f.properties.fill === "string"
              ? f.properties.fill
              : f.feature_type === "ROAD"
                ? "#ccbb98"
                : "#a79070";
          return (
            <g key={f.feature_id}>
              {raised && cartography === "bench" && (
                <polygon
                  points={points}
                  transform={`translate(0 ${1.1 * unit})`}
                  fill="#494a40"
                />
              )}
              <polygon
                points={points}
                fill={fill}
                stroke={cartography === "bench" ? "#d1b595" : "#7b8064"}
                strokeWidth={unit * 0.25}
              />
              {f.label === "Pit benches" && (
                <text
                  x={
                    f.points.reduce((sum, p) => sum + project(p)[0], 0) /
                    f.points.length
                  }
                  y={
                    f.points.reduce((sum, p) => sum + project(p)[1], 0) /
                    f.points.length
                  }
                  textAnchor="middle"
                  fontSize={unit * 1.8}
                  fill="#fff4db"
                >
                  Pit benches
                </text>
              )}
            </g>
          );
        }
        if (f.geometry_type === "POLYLINE") {
          if (!showRoute && f.feature_type === "ROUTE") return null;
          if (f.feature_type === "BERM" || f.feature_type === "CENTERLINE")
            return null;
          return (
            <polyline
              key={f.feature_id}
              points={points}
              fill="none"
              stroke={f.feature_type === "ROUTE" ? "#338ef3" : "#8ba27a"}
              strokeWidth={unit * (f.feature_type === "ROUTE" ? 0.48 : 0.14)}
              opacity={0.85}
            />
          );
        }
        const [x, y] = project(f.points[0]);
        return (
          <g key={f.feature_id} transform={`translate(${x} ${y})`}>
            <path
              d={`M${-2 * unit} 0v${-2 * unit}l${2 * unit} ${-unit}l${2 * unit} ${unit}v${2 * unit}Z`}
              fill="#d9e0d7"
              stroke="#4c6558"
              strokeWidth={unit * 0.25}
            />
            <text
              y={unit * 3.5}
              textAnchor="middle"
              fontSize={unit * 1.6}
              fontWeight="600"
              fill="#f4f3dc"
              paintOrder="stroke"
              stroke="#344936"
              strokeWidth={unit * 0.35}
            >
              {f.feature_type === "DESTINATION"
                ? "Crusher / unloading"
                : f.label}
            </text>
          </g>
        );
      })}
    </g>
  );
});

export const planProjection = (p: Point2D): [number, number] => [p.x_m, -p.y_m];
