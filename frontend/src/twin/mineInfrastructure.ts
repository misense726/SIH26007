import * as THREE from "three";
import type { MapFeature } from "../types";
import type { TerrainField } from "./terrainField";

export function buildInfrastructure(
  features: MapFeature[],
  field: TerrainField,
): THREE.Group {
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: "#818e8d",
    metalness: 0.65,
    roughness: 0.55,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: "#303937",
    metalness: 0.25,
    roughness: 0.85,
  });
  const concrete = new THREE.MeshStandardMaterial({
    color: "#b4afa0",
    roughness: 0.95,
  });
  const yellow = new THREE.MeshStandardMaterial({
    color: "#ce9a31",
    metalness: 0.3,
    roughness: 0.6,
  });
  const ore = new THREE.MeshStandardMaterial({
    color: "#775441",
    roughness: 1,
  });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  function box(
    parent: THREE.Group,
    size: number[],
    at: number[],
    material: THREE.Material,
  ) {
    const m = new THREE.Mesh(boxGeometry, material);
    m.scale.set(size[0], size[1], size[2]);
    m.position.set(at[0], at[1], at[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function beam(
    parent: THREE.Group,
    a: THREE.Vector3,
    b: THREE.Vector3,
    width: number,
    material: THREE.Material,
  ) {
    const m = new THREE.Mesh(boxGeometry, material),
      delta = b.clone().sub(a);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(width, delta.length(), width);
    m.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    );
    m.castShadow = true;
    parent.add(m);
  }
  const dump = features.find((f) => f.feature_type === "DESTINATION")
    ?.points[0];
  if (dump) {
    const plant = new THREE.Group(),
      x = dump.x_m + 4,
      y = dump.y_m + 1,
      h = field(x, y).elevation;
    plant.position.set(x, h, -y);
    root.add(plant);
    box(plant, [7, 0.45, 8], [2, 0, 0], concrete);
    box(plant, [4.2, 3.3, 4.4], [3, 2.5, 1], steel);
    box(plant, [4.7, 0.25, 4.9], [3, 4.35, 1], dark);
    for (let i = 0; i < 10; i++)
      box(plant, [0.08, 3.2, 4.48], [1.1 + i * 0.42, 2.5, 1], concrete);
    const hopper = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 0.8, 2.4, 4, 1, true),
      steel,
    );
    hopper.rotation.y = Math.PI / 4;
    hopper.position.set(-0.5, 3.5, -1);
    hopper.castShadow = true;
    plant.add(hopper);
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), dark);
    opening.rotation.x = -Math.PI / 2;
    opening.position.set(-0.5, 4.45, -1);
    plant.add(opening);
    for (const px of [-2, 1])
      for (const pz of [-2.5, 0.5])
        box(plant, [0.18, 3.5, 0.18], [px, 1.75, pz], steel);
    for (let i = 0; i < 13; i++)
      box(
        plant,
        [0.85, 0.12, 0.25],
        [5.6, 0.3 + i * 0.3, -2.4 + i * 0.24],
        steel,
      );
    beam(
      plant,
      new THREE.Vector3(5.1, 1, -2.7),
      new THREE.Vector3(5.1, 5, 1),
      0.06,
      yellow,
    );
    const end = new THREE.Vector3(18, 2.2, 15),
      start = new THREE.Vector3(3, 3.2, 3);
    const conveyor = new THREE.Group();
    conveyor.position.copy(start).add(end).multiplyScalar(0.5);
    conveyor.lookAt(end);
    plant.add(conveyor);
    const length = start.distanceTo(end);
    box(conveyor, [1.4, 0.16, length], [0, 0, 0], dark);
    for (const side of [-0.8, 0.8]) {
      box(conveyor, [0.12, 0.28, length], [side, -0.12, 0], steel);
      box(conveyor, [0.06, 0.06, length], [side, 0.9, 0], yellow);
      for (let z = -length / 2; z < length / 2; z += 1.4)
        box(conveyor, [0.06, 1, 0.06], [side, 0.42, z], steel);
    }
    for (let t = 0.1; t < 1; t += 0.18) {
      const p = start.clone().lerp(end, t);
      for (const dx of [-0.8, 0.8])
        beam(
          plant,
          new THREE.Vector3(p.x + dx, -0.1, p.z),
          new THREE.Vector3(p.x + dx, p.y, p.z),
          0.16,
          steel,
        );
    }
    const pile = new THREE.Mesh(new THREE.ConeGeometry(4.6, 3.4, 32), ore);
    pile.position.set(18, 0.7, 15);
    pile.castShadow = true;
    pile.receiveShadow = true;
    plant.add(pile);
  }
  const start = features.find((f) => f.feature_type === "START")?.points[0];
  if (start) {
    const loader = new THREE.Group();
    loader.position.set(
      start.x_m - 3,
      field(start.x_m - 3, start.y_m).elevation,
      -start.y_m,
    );
    loader.rotation.y = 0.4;
    root.add(loader);
    for (const x of [-0.8, 0.8])
      box(loader, [0.45, 0.48, 2.2], [x, 0.3, 0], dark);
    box(loader, [1.8, 0.7, 1.8], [0, 0.88, 0], yellow);
    box(loader, [0.7, 1, 0.8], [-0.45, 1.6, 0.25], steel);
    beam(
      loader,
      new THREE.Vector3(0.4, 1.2, -0.5),
      new THREE.Vector3(0.3, 3.7, -1.5),
      0.35,
      yellow,
    );
    beam(
      loader,
      new THREE.Vector3(0.3, 3.7, -1.5),
      new THREE.Vector3(0.3, 1.1, -3.2),
      0.25,
      yellow,
    );
    box(loader, [1, 0.65, 0.75], [0.3, 0.8, -3.1], dark);
    beam(
      loader,
      new THREE.Vector3(0.5, 1.5, -0.7),
      new THREE.Vector3(0.5, 3.2, -1.3),
      0.1,
      steel,
    );
  }
  const yard = features.find((f) => f.feature_id === "service-yard")?.points[0];
  if (yard) {
    const shed = new THREE.Group();
    shed.position.set(
      yard.x_m + 2,
      field(yard.x_m, yard.y_m).elevation,
      -yard.y_m,
    );
    root.add(shed);
    box(shed, [6, 0.3, 5], [0, 0, 0], concrete);
    box(shed, [6, 2.8, 0.2], [0, 1.5, -2], steel);
    box(shed, [6.6, 0.25, 5.6], [0, 3, 0], steel);
    for (const x of [-2.8, 0, 2.8])
      box(shed, [0.18, 3, 0.18], [x, 1.5, 2.2], steel);
    for (let i = 0; i < 3; i++)
      box(shed, [1.4, 0.7, 1], [i * 1.6 - 1.8, 0.6, -1], yellow);
  }
  return root;
}
