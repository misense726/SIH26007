import { useRef, useState } from "react";
import type { HaulRouteState, MapFeature } from "../types";
import type { SupervisorVehicle } from "../supervisor/supervisorViewModel";
import "./mineMap.css";
import { MineTerrainView } from "./MineTerrainView";
import { MinePlanView } from "./MinePlanView";
import type { MineRenderer } from "./mineRenderer";

export function MineFleetMap({
  features,
  vehicles,
  haul,
  selectedTruckId,
  onSelectTruck,
}: {
  features: MapFeature[];
  vehicles: SupervisorVehicle[];
  haul?: HaulRouteState | null;
  selectedTruckId?: string | null;
  onSelectTruck?: (id: string | null) => void;
}) {
  const [tilted, setTilted] = useState(true);
  const controller = useRef<MineRenderer | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [routeVisible, setRouteVisible] = useState(true);
  return (
    <div className="mine-fleet-map" data-view={tilted ? "terrain" : "plan"}>
      <div className="mine-map-tools">
        <span>Mine operations</span>
        <div>
          {tilted ? (
            <>
              <button onClick={() => controller.current?.focus("pit")}>
                Mining area
              </button>
              <button onClick={() => controller.current?.focus("truck")}>
                Active dumper
              </button>
              <button onClick={() => controller.current?.focus("crusher")}>
                Crusher
              </button>
            </>
          ) : (
            <button
              onClick={() => setRouteVisible((v) => !v)}
              aria-pressed={routeVisible}
            >
              Assigned route
            </button>
          )}
          <button
            onClick={() =>
              tilted
                ? controller.current?.zoom(0.8)
                : setZoom((z) => Math.min(3.5, z * 1.25))
            }
            aria-label="Zoom into mine"
          >
            +
          </button>
          <button
            onClick={() =>
              tilted
                ? controller.current?.zoom(1.25)
                : setZoom((z) => Math.max(0.7, z / 1.25))
            }
            aria-label="Zoom out of mine"
          >
            −
          </button>
          <button onClick={() => setTilted(false)} aria-pressed={!tilted}>
            2D plan
          </button>
          <button onClick={() => setTilted(true)} aria-pressed={tilted}>
            3D site
          </button>
          <button
            onClick={() => {
              setZoom(1);
              controller.current?.fit();
              setPan({ x: 0, y: 0 });
            }}
          >
            Fit site
          </button>
        </div>
      </div>
      {tilted ? (
        <MineTerrainView
          features={features}
          frame={{ vehicles, haul, selected: selectedTruckId }}
          controller={controller}
          onSelect={(id) => onSelectTruck?.(id)}
        />
      ) : (
        <MinePlanView
          features={features}
          vehicles={vehicles}
          haul={haul}
          selectedTruckId={selectedTruckId}
          onSelectTruck={onSelectTruck}
          zoom={zoom}
          pan={pan}
          onPan={setPan}
          routeVisible={routeVisible}
        />
      )}
      <div className="mine-map-key">
        <span>{haul?.next_instruction ?? "Haul circuit"}</span>
        <span>Trip {haul?.cycle ?? 1}</span>
        <span>Conceptual site, local metres</span>
      </div>
    </div>
  );
}
