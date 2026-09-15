import * as THREE from "three";
import type { MapFeature } from "../types";
import type { TerrainField } from "./terrainField";
import { edgeDistance, insidePolygon } from "./terrainField";
import { crusherLayout } from "./crusherLayout";
import { buildCrusherStation } from "./crusherStation";

export function pitExcavatorPositions(features: MapFeature[], field: TerrainField) {
  const floor = features.filter((f) => f.properties.cartography === "bench")
    .sort((a, b) => Number(b.properties.level) - Number(a.properties.level))[0];
  if (!floor) return [];
  const loading = features.find((f) => f.properties.cartography === "pit-floor")?.points[0];
  const xs = floor.points.map((p) => p.x_m), ys = floor.points.map((p) => p.y_m);
  const candidates: { x: number; y: number; height: number }[] = [];
  for (let x = Math.min(...xs) + 5; x < Math.max(...xs) - 5; x += 2)
    for (let y = Math.min(...ys) + 5; y < Math.max(...ys) - 5; y += 2) {
      if (!insidePolygon(x, y, floor.points) || edgeDistance(x, y, floor.points) < 5) continue;
      const ground = field(x, y);
      if (ground.road || ground.edge < 5 || ground.elevation > -14) continue;
      candidates.push({ x, y, height: ground.elevation });
    }
  candidates.sort((a, b) => Math.hypot(a.x - (loading?.x_m ?? 0), a.y - (loading?.y_m ?? 0)) -
    Math.hypot(b.x - (loading?.x_m ?? 0), b.y - (loading?.y_m ?? 0)));
  const first = candidates[0];
  if (!first) return [];
  const second = candidates.find((p) => Math.hypot(p.x - first.x, p.y - first.y) >= 14);
  return second ? [first, second] : [first];
}

export function buildInfrastructure(
  features: MapFeature[],
  field: TerrainField,
): THREE.Group {
  const root = new THREE.Group();
  root.name = "nmdc-bailadila-deposit14-infrastructure";

  // Shared PBR materials matching industrial iron ore mining site
  const steel = new THREE.MeshStandardMaterial({
    color: "#60747d",
    metalness: 0.65,
    roughness: 0.45,
  });
  const darkMachinery = new THREE.MeshStandardMaterial({
    color: "#222a2d",
    metalness: 0.35,
    roughness: 0.85,
  });
  const plantConcrete = new THREE.MeshStandardMaterial({
    color: "#9e9a8d",
    roughness: 0.95,
  });
  const industrialSiding = new THREE.MeshStandardMaterial({
    color: "#9a7760",
    metalness: 0.3,
    roughness: 0.86,
  });
  const plantRoofBlue = new THREE.MeshStandardMaterial({
    color: "#87513b",
    metalness: 0.25,
    roughness: 0.65,
  });
  const miningYellow = new THREE.MeshStandardMaterial({
    color: "#d9a128",
    metalness: 0.25,
    roughness: 0.55,
  });
  const safetyRailing = new THREE.MeshStandardMaterial({
    color: "#e2ad2b",
    roughness: 0.6,
  });
  const oreRedHematite = new THREE.MeshStandardMaterial({
    color: "#682a1f",
    roughness: 0.98,
  });
  const oreGreyLump = new THREE.MeshStandardMaterial({
    color: "#4a4947",
    roughness: 0.96,
  });
  const glassCab = new THREE.MeshStandardMaterial({
    color: "#7fa3b3",
    metalness: 0.85,
    roughness: 0.15,
  });

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

  function box(
    parent: THREE.Group,
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material,
    castShadow = true,
  ) {
    const m = new THREE.Mesh(boxGeo, material);
    m.scale.set(size[0], size[1], size[2]);
    m.position.set(at[0], at[1], at[2]);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function beam(
    parent: THREE.Group,
    a: THREE.Vector3,
    b: THREE.Vector3,
    thickness: number,
    material: THREE.Material,
  ) {
    const delta = b.clone().sub(a);
    const len = delta.length();
    if (len < 0.001) return;
    const m = new THREE.Mesh(boxGeo, material);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(thickness, len, thickness);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  }

  // -------------------------------------------------------------
  // 1. PRIMARY CRUSHING & SIZING COMPLEX (Near Dump Point)
  // -------------------------------------------------------------
  const station = crusherLayout(features);
  root.add(buildCrusherStation(station));
  const crusherOriginX = station.x + 7;
  const crusherOriginY = station.y;
  const crusherBaseH = station.elevation;

  // -------------------------------------------------------------
  // 2. LONG OVERLAND DOWNHILL CONVEYOR TO LOWER STOCKYARD
  // -------------------------------------------------------------
  // Starts at the crusher discharge and travels down the south-eastern slope
  const convStartX = crusherOriginX + 6.2;
  const convStartY = crusherOriginY - 1.5;
  const convStartH = crusherBaseH + 3.8;

  // Lower stockyard destination
  const stockyardX = crusherOriginX + 78.0;
  const stockyardY = crusherOriginY - 54.0;
  const stockyardBaseH = field(stockyardX, stockyardY).elevation;
  const convEndH = stockyardBaseH + 6.5;

  const conveyorStart = new THREE.Vector3(convStartX, convStartH, -convStartY);
  const conveyorEnd = new THREE.Vector3(stockyardX, convEndH, -stockyardY);

  const conveyorVector = conveyorEnd.clone().sub(conveyorStart);
  const totalLength = conveyorVector.length();
  const conveyorMid = conveyorStart.clone().add(conveyorEnd).multiplyScalar(0.5);

  const conveyorGallery = new THREE.Group();
  conveyorGallery.position.copy(conveyorMid);
  conveyorGallery.lookAt(conveyorEnd);
  root.add(conveyorGallery);

  // Enclosed blue/grey conveyor hood tube
  box(conveyorGallery, [1.7, 1.4, totalLength], [0, 0, 0], industrialSiding);
  box(conveyorGallery, [1.8, 0.35, totalLength], [0, 0.75, 0], plantRoofBlue);
  box(conveyorGallery, [0.15, 0.8, totalLength], [0.95, 0, 0], safetyRailing); // Catwalk side walkway

  // Structural lattice bents / support towers every 10 meters along the slope
  const towerSpacing = 9.5;
  const towerCount = Math.floor(totalLength / towerSpacing);

  for (let i = 1; i < towerCount; i++) {
    const t = i / towerCount;
    const towerTop = conveyorStart.clone().lerp(conveyorEnd, t);
    // Find ground elevation below this point
    const gWorldX = towerTop.x;
    const gWorldY = -towerTop.z;
    const groundH = field(gWorldX, gWorldY).elevation;
    const towerH = towerTop.y - groundH;

    if (towerH > 0.5) {
      const towerGroup = new THREE.Group();
      towerGroup.position.set(gWorldX, groundH, towerTop.z);
      root.add(towerGroup);

      // Concrete foundation pier
      box(towerGroup, [2.4, 0.8, 2.4], [0, 0.4, 0], plantConcrete);

      // 4-legged structural steel lattice tower
      const colMat = steel;
      const legSpan = Math.min(1.8, 0.8 + towerH * 0.08);
      for (const lx of [-legSpan / 2, legSpan / 2]) {
        for (const lz of [-legSpan / 2, legSpan / 2]) {
          beam(
            towerGroup,
            new THREE.Vector3(lx, 0.8, lz),
            new THREE.Vector3(lx * 0.5, towerH, lz * 0.5),
            0.18,
            colMat,
          );
        }
      }
      // Horizontal and X-bracing ties
      const tiers = Math.max(1, Math.floor(towerH / 3.0));
      for (let tier = 1; tier <= tiers; tier++) {
        const hTier = (towerH * tier) / (tiers + 1);
        box(towerGroup, [legSpan * 0.75, 0.14, legSpan * 0.75], [0, hTier, 0], steel);
      }
    }
  }

  // -------------------------------------------------------------
  // 3. LOWER STOCKYARD & LOADOUT COMPLEX
  // -------------------------------------------------------------
  const yardGroup = new THREE.Group();
  yardGroup.position.set(stockyardX, stockyardBaseH, -stockyardY);
  root.add(yardGroup);

  // Large graded stockyard pad
  box(yardGroup, [52, 0.5, 46], [6, -0.2, 0], plantConcrete);

  // Secondary transfer station & screening building at conveyor discharge
  box(yardGroup, [8.2, 7.5, 9.4], [0, 3.8, 0], industrialSiding);
  box(yardGroup, [8.8, 0.4, 10.0], [0, 7.7, 0], plantRoofBlue);

  // Radial stacker conveyor extending over the main iron ore stockpile
  const stackerArm = new THREE.Group();
  stackerArm.position.set(3.5, 5.0, 4.0);
  stackerArm.rotation.set(-0.25, 0.55, 0);
  yardGroup.add(stackerArm);
  box(stackerArm, [1.3, 0.9, 18], [0, 0, 9], industrialSiding);
  box(stackerArm, [0.12, 0.5, 18], [0.75, 0.1, 9], safetyRailing);

  // Multiple large conical and elongated iron ore stockpiles (Fines and Lumps)
  // Pile 1: Large primary hematite ore mound
  const pile1 = new THREE.Mesh(new THREE.ConeGeometry(9.5, 5.8, 36), oreRedHematite);
  pile1.position.set(13.0, 2.7, 14.0);
  pile1.castShadow = true;
  pile1.receiveShadow = true;
  yardGroup.add(pile1);

  // Pile 2: Blended iron ore lump stockpile (charcoal grey)
  const pile2 = new THREE.Mesh(new THREE.ConeGeometry(8.2, 4.9, 32), oreGreyLump);
  pile2.position.set(19.0, 2.3, -8.0);
  pile2.castShadow = true;
  pile2.receiveShadow = true;
  yardGroup.add(pile2);

  // Pile 3: Sinter feed fine ore stockpile
  const pile3 = new THREE.Mesh(new THREE.ConeGeometry(6.8, 3.8, 28), oreRedHematite);
  pile3.position.set(27.0, 1.8, 5.0);
  pile3.castShadow = true;
  pile3.receiveShadow = true;
  yardGroup.add(pile3);

  // Heavy truck loadout silos / bins with drive-under clearance
  const siloGroup = new THREE.Group();
  siloGroup.position.set(-8.0, 0, 10.0);
  yardGroup.add(siloGroup);
  for (let sIdx = 0; sIdx < 2; sIdx++) {
    const sCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.1, 5.2, 16),
      steel,
    );
    sCyl.position.set(sIdx * 4.6, 6.2, 0);
    sCyl.castShadow = true;
    siloGroup.add(sCyl);

    const sCone = new THREE.Mesh(
      new THREE.ConeGeometry(2.1, 2.2, 16),
      steel,
    );
    sCone.position.set(sIdx * 4.6, 2.5, 0);
    sCone.rotation.x = Math.PI;
    siloGroup.add(sCone);

    // Support legs
    for (const lx of [-1.8, 1.8]) {
      for (const lz of [-1.8, 1.8]) {
        box(siloGroup, [0.35, 4.8, 0.35], [sIdx * 4.6 + lx, 2.4, lz], steel);
      }
    }
  }

  // Stockyard administration building and electrical substation
  box(yardGroup, [8.4, 3.4, 5.2], [-14, 1.7, -8], industrialSiding);
  box(yardGroup, [8.8, 0.3, 5.6], [-14, 3.5, -8], plantRoofBlue);
  box(yardGroup, [4.2, 2.4, 3.2], [-12, 1.2, -14], steel); // Substation

  // -------------------------------------------------------------
  // Pit-floor excavators share geometry and materials.
  // -------------------------------------------------------------
  const excavator = new THREE.Group();

  // Crawler track assemblies (left and right)
  for (const trackX of [-1.5, 1.5]) {
    // Main track beam
    box(excavator, [0.85, 0.85, 4.6], [trackX, 0.45, 0], darkMachinery);
    // Beveled track ends (front and rear tumblers)
    for (const trackEnd of [-2.3, 2.3]) {
      const endCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.85, 8),
        darkMachinery,
      );
      endCyl.rotation.z = Math.PI / 2;
      endCyl.position.set(trackX, 0.45, trackEnd);
      excavator.add(endCyl);
    }
    // Track rollers
    for (let r = -1.6; r <= 1.6; r += 0.65) {
      box(excavator, [0.95, 0.2, 0.4], [trackX, 0.15, r], steel);
    }
  }

  // Carbody & turntable slewing ring
  box(excavator, [2.4, 0.5, 3.0], [0, 0.75, 0], darkMachinery);
  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.35, 16), steel);
  turntable.position.set(0, 1.1, 0);
  excavator.add(turntable);

  // Revolving upper house / machinery deck
  const house = new THREE.Group();
  house.position.set(0, 1.3, 0);
  house.rotation.y = 0.35; // Rotated towards the iron ore dig face
  excavator.add(house);

  // Machine house body & heavy rear counterweight
  box(house, [3.2, 1.9, 3.8], [0, 1.15, -0.4], miningYellow);
  box(house, [3.25, 1.8, 1.4], [0, 1.2, -2.1], darkMachinery); // Counterweight
  // Exhaust stacks and cooling vents
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), darkMachinery);
  exhaust.position.set(0.9, 2.6, -1.8);
  house.add(exhaust);

  // Elevated operator's cab with glass windows (front-left)
  box(house, [1.1, 1.6, 1.4], [-1.2, 1.9, 1.2], miningYellow);
  box(house, [1.02, 0.95, 1.25], [-1.2, 2.1, 1.25], glassCab);

  // 2-piece heavy mining shovel boom
  const boomBase = new THREE.Vector3(0.5, 1.2, 1.6);
  const boomKnee = new THREE.Vector3(0.5, 5.2, 4.4);
  const boomTip = new THREE.Vector3(0.5, 4.8, 7.6);
  beam(house, boomBase, boomKnee, 0.55, miningYellow);
  beam(house, boomKnee, boomTip, 0.45, miningYellow);

  // Hydraulic lift cylinders
  for (const cylSide of [-0.45, 0.45]) {
    beam(
      house,
      new THREE.Vector3(0.5 + cylSide, 0.6, 1.0),
      new THREE.Vector3(0.5 + cylSide * 0.7, 3.4, 3.2),
      0.18,
      steel,
    );
  }

  // Stick / dipper arm
  const stickPivot = boomTip.clone();
  const bucketPivot = new THREE.Vector3(0.5, 1.8, 8.4);
  beam(house, stickPivot, bucketPivot, 0.38, miningYellow);

  // Heavy-duty toothed mining rock bucket
  const bucketGroup = new THREE.Group();
  bucketGroup.position.copy(bucketPivot);
  bucketGroup.rotation.x = -0.3;
  house.add(bucketGroup);
  box(bucketGroup, [1.6, 1.4, 1.5], [0, 0, 0.6], darkMachinery);
  // Bucket digging teeth
  for (let tooth = -0.65; tooth <= 0.65; tooth += 0.32) {
    box(bucketGroup, [0.15, 0.18, 0.5], [tooth, -0.6, 1.45], steel);
  }

  // Pile of blasted iron ore rock being dug by the excavator
  const digPile = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.2, 20), oreRedHematite);
  digPile.position.set(0.5, 0.8, 9.8);
  digPile.castShadow = true;
  house.add(digPile);

  for (const [index, position] of pitExcavatorPositions(features, field).entries()) {
    const shovel = index === 0 ? excavator : excavator.clone(true);
    shovel.name = `pit-floor-excavator-${index + 1}`;
    shovel.position.set(position.x, position.height + 0.1, -position.y);
    shovel.rotation.y = index === 0 ? Math.PI : 0.2;
    root.add(shovel);
  }

  // -------------------------------------------------------------
  // 7. MINE MAINTENANCE & SERVICE COMPOUND
  // -------------------------------------------------------------
  const yardFeature = features.find((f) => f.feature_id === "service-yard")?.points[0];
  if (yardFeature) {
    const yardH = field(yardFeature.x_m, yardFeature.y_m).elevation;
    const yardGroup = new THREE.Group();
    yardGroup.position.set(yardFeature.x_m + 2, yardH, -yardFeature.y_m);
    root.add(yardGroup);

    box(yardGroup, [10, 0.4, 8], [0, 0.2, 0], plantConcrete);
    box(yardGroup, [9.2, 3.4, 0.2], [0, 1.9, -3.8], industrialSiding); // Back wall
    box(yardGroup, [9.6, 0.3, 7.8], [0, 3.7, 0], plantRoofBlue); // Heavy canopy
    for (const px of [-4.2, 0, 4.2]) {
      box(yardGroup, [0.3, 3.5, 0.3], [px, 1.8, 3.6], steel);
    }
    // Heavy equipment maintenance bays
    for (let bay = 0; bay < 3; bay++) {
      box(yardGroup, [2.2, 1.1, 1.4], [bay * 2.8 - 2.8, 0.8, -1.6], miningYellow);
    }
  }

  return root;
}
