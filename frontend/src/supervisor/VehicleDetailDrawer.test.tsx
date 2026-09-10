import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VehicleDetailDrawer } from "./VehicleDetailDrawer";

describe("VehicleDetailDrawer", () => {
  it("returns null when truckId is null", () => {
    const markup = renderToStaticMarkup(
      <VehicleDetailDrawer
        truckId={null}
        onClose={() => {}}
      />,
    );
    expect(markup).toBe("");
  });

  it("renders missing fleet summary as UNVERIFIED without fabricated details", () => {
    const markup = renderToStaticMarkup(
      <VehicleDetailDrawer
        truckId="DUMPER_01"
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("UNVERIFIED");
    expect(markup).not.toContain("TRAVELLING TO DUMP");
    expect(markup).not.toContain("85 T Total Mass");
    expect(markup).not.toContain("Primary Crusher #01");
  });

  it("renders vehicle details, payload mass, and cycle state when selected", () => {
    const markup = renderToStaticMarkup(
      <VehicleDetailDrawer
        truckId="DUMPER_01"
        summary={{
          vehicle_id: "DUMPER_01",
          callsign: "Bailadila Shovel Hauler #01",
          is_primary: true,
          is_simulated: true,
          cycle_state: "TRAVELLING_TO_DUMP",
          payload_tonnes: 100.0,
          tare_weight_tonnes: 85.0,
          total_weight_tonnes: 185.0,
          x_m: 25.0,
          y_m: 70.0,
          elevation_m: 560.0,
          heading_deg: 180.0,
          speed_mps: 6.0,
          speed_kmh: 21.6,
          emergency_state: "SAFE",
          assigned_pickup: "PICKUP_NORTH_BENCH",
          assigned_dump: "DUMP_PRIMARY_CRUSHER",
          total_trips_completed: 4,
          total_tonnes_moved: 400.0,
          current_destination: "Primary Gyratory Crusher #01",
          distance_to_destination_m: 65.0,
          next_instruction: "In 45m bear right onto Central Spine.",
        }}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("Bailadila Shovel Hauler #01");
    expect(markup).toContain("LOADED 100T");
    expect(markup).toContain("185 T Total Mass");
    expect(markup).toContain("TRAVELLING TO DUMP");
  });
});
