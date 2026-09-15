import * as THREE from "three";
import type { crusherLayout } from "./crusherLayout";

export function buildCrusherStation(site: ReturnType<typeof crusherLayout>) {
  const root = new THREE.Group();
  root.name = "covered-crusher-station";
  root.position.set(site.x, site.elevation, -site.y);
  const steel = new THREE.MeshStandardMaterial({ color: "#39494c", metalness: 0.65, roughness: 0.65 });
  const sheet = new THREE.MeshStandardMaterial({ color: "#8f7561", metalness: 0.35, roughness: 0.83 });
  const roof = new THREE.MeshStandardMaterial({ color: "#844d36", metalness: 0.3, roughness: 0.86 });
  const concrete = new THREE.MeshStandardMaterial({ color: "#9c998d", roughness: 1 });
  const yellow = new THREE.MeshStandardMaterial({ color: "#dab137", roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: "#272c29", roughness: 0.9 });
  const ore = new THREE.MeshStandardMaterial({ color: "#59433a", roughness: 1 });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  function box(name: string, size: number[], at: number[], material: THREE.Material) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.name = name;
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(at[0], at[1], at[2]);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  function beam(a: number[], b: number[], width = 0.13) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const direction = to.clone().sub(from);
    const mesh = box("steel-bracing", [width, direction.length(), width], from.add(to).multiplyScalar(0.5).toArray(), steel);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  }
  // A continuous apron stops before the pocket. All truck wheels remain on concrete.
  box("tipping-apron", [7.05, 0.28, 7], [-1.975, -0.08, 0], concrete);
  for (const z of [-3.15, 3.15]) {
    box("pocket-side-wall", [6.5, 1, 0.65], [4.8, 0.35, z], concrete);
    box("apron-kerb", [4.3, 0.2, 0.25], [-0.6, 0.12, z], concrete);
  }
  box("rear-wheel-stop", [0.22, 0.22, 3.5], [1.25, 0.12, 0], yellow);
  for (let z = -1.5; z <= 1.5; z += 0.5)
    box("wheel-stop-stripe", [0.23, 0.225, 0.22], [1.25, 0.12, z], dark);

  // Four sloping steel plates enclose the rectangular receiving pocket.
  const pocket = new THREE.BufferGeometry();
  const top = [[1.55, 0.06, -2.35], [6.45, 0.06, -2.35], [6.45, 0.06, 2.35], [1.55, 0.06, 2.35]];
  const bottom = [[3.25, -3.2, -0.8], [4.75, -3.2, -0.8], [4.75, -3.2, 0.8], [3.25, -3.2, 0.8]];
  const vertices: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    vertices.push(...top[i], ...bottom[i], ...top[j], ...top[j], ...bottom[i], ...bottom[j]);
  }
  pocket.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  pocket.computeVertexNormals();
  const liner = steel.clone(); liner.side = THREE.DoubleSide;
  const hopper = new THREE.Mesh(pocket, liner);
  hopper.name = "receiving-pocket";
  root.add(hopper);
  const mantle = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.8, 16), steel);
  mantle.name = "gyratory-crusher-mantle";
  mantle.position.set(4, -2.5, 0); root.add(mantle);
  box("pocket-ore", [1.5, 0.18, 1.5], [4, -3.35, 0], ore);
  box("pocket-rear-wall", [0.5, 1.2, 6.3], [6.7, 0.5, 0], concrete);

  // Full-height siding and a complete pitched roof, with an open road-facing portal.
  for (const z of [-3.5, 3.5]) {
    box("concrete-plinth", [10, 0.9, 0.35], [3, 0.35, z], concrete);
    box("corrugated-side-wall", [10, 5.1, 0.12], [3, 3.45, z], sheet);
    for (let x = -2; x <= 8; x += 0.32)
      box("wall-corrugation", [0.045, 5.1, 0.08], [x, 3.45, z + Math.sign(z) * 0.08], sheet);
    for (const x of [-2, 1.3, 4.6, 8]) {
      box("column-footing", [0.8, 0.3, 0.8], [x, 0, z], concrete);
      box("portal-column", [0.22, 6, 0.22], [x, 3, z], steel);
    }
    for (const x of [1.3, 4.6]) beam([x, 0.9, z - Math.sign(z) * 0.12], [x + 3.3, 5.6, z - Math.sign(z) * 0.12]);
  }
  box("rear-cladding", [0.14, 6, 7], [8, 3, 0], sheet);
  box("entry-header", [0.18, 0.6, 7], [-2, 5.7, 0], sheet);
  const gableMaterial = sheet.clone(); gableMaterial.side = THREE.DoubleSide;
  for (const x of [-2, 8]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      x, 6, -3.5, x, 6.96, 0, x, 6, 3.5,
    ], 3));
    geometry.computeVertexNormals();
    const gable = new THREE.Mesh(geometry, gableMaterial);
    gable.name = "closed-gable";
    gable.castShadow = true;
    root.add(gable);
  }
  for (const side of [-1, 1]) {
    const panel = box("continuous-pitched-roof", [10.8, 0.16, 3.92], [3, 6.48, side * 1.87], roof);
    panel.rotation.x = side * Math.atan2(0.96, 3.74);
    for (let x = -2.4; x <= 8.4; x += 0.4) {
      const rib = box("roof-seam", [0.04, 0.055, 3.92], [x, 6.59, side * 1.87], roof);
      rib.rotation.x = panel.rotation.x;
    }
  }
  box("ridge-cap", [10.9, 0.16, 0.25], [3, 7.02, 0], roof);
  for (const x of [-2, 1.3, 4.6, 8]) {
    beam([x, 6, -3.5], [x, 6.95, 0], 0.18);
    beam([x, 6.95, 0], [x, 6, 3.5], 0.18);
    beam([x, 5.6, -3.5], [x, 5.6, 3.5], 0.15);
  }
  for (const z of [-3.5, 3.5]) {
    box("rain-gutter", [10.8, 0.16, 0.16], [3, 5.94, z], steel);
    box("downpipe", [0.1, 5.8, 0.1], [7.8, 2.9, z + Math.sign(z) * 0.2], steel);
  }
  for (const z of [-3.3, 3.3]) {
    box("portal-bollard", [0.22, 1.2, 0.22], [-2.6, 0.6, z], yellow);
    box("portal-bollard-band", [0.23, 0.2, 0.23], [-2.6, 0.65, z], dark);
  }
  const lampMaterial = new THREE.MeshStandardMaterial({ color: "#fff0c5", emissive: "#ffce83", emissiveIntensity: 0.5 });
  for (const x of [-1.5, 2, 5.5]) box("bay-light", [0.9, 0.12, 0.3], [x, 5.55, 0], lampMaterial);
  const light = new THREE.PointLight("#ffe3b0", 26, 12, 2);
  light.position.set(0, 4.4, 0); root.add(light);

  // Enclosed processing tower and discharge gallery behind the receiving hall.
  box("crusher-processing-house", [5.6, 8.2, 7.5], [10.8, 4, 0], sheet);
  box("processing-house-roof", [6, 0.22, 7.9], [10.8, 8.22, 0], roof);
  for (let x = 8; x < 13.7; x += 0.36)
    for (const z of [-3.78, 3.78]) box("tower-corrugation", [0.045, 8.1, 0.07], [x, 4, z], sheet);
  for (const y of [2.6, 5.2]) {
    box("maintenance-walkway", [5.8, 0.12, 0.85], [10.8, y, 4.1], steel);
    for (const railY of [y + 0.5, y + 1]) box("catwalk-handrail", [5.8, 0.055, 0.055], [10.8, railY, 4.5], yellow);
    for (let x = 8; x <= 13.6; x += 1.1) box("catwalk-post", [0.055, 1, 0.055], [x, y + 0.5, 4.5], yellow);
  }
  for (const x of [13.4, 13.9]) box("ladder-rail", [0.07, 5.4, 0.07], [x, 2.6, 4.1], steel);
  for (let y = 0.2; y < 5.3; y += 0.3) box("ladder-rung", [0.57, 0.055, 0.055], [13.65, y, 4.1], steel);
  box("extraction-duct", [1.2, 0.7, 5], [11.5, 8.7, 0], steel);
  return root;
}
