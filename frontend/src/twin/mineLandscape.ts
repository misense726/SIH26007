import * as THREE from "three";
import type { MapFeature } from "../types";
import { createTerrainField, grain, gradedRoads, noise, type TerrainField } from "./terrainField";

const rockTones = ["#a2755d", "#797976", "#966851", "#696d70", "#97664f", "#777878", "#96634d", "#6e7274", "#855f51", "#747675", "#96654e"];
const forestTones = ["#344e29", "#486035", "#3d5b31", "#57713b", "#314b2b", "#657943", "#455e32"];

export function textureGrain(): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const v = 155 + Math.round(grain(x, y) * 70 + noise(x * 0.2, y * 0.2) * 30);
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function terrainGeometry(field: TerrainField) {
  const geometry = new THREE.PlaneGeometry(340, 320, 612, 576);
  geometry.rotateX(-Math.PI / 2);
  const points = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  const colors = new Float32Array(points.count * 3), roadMask = new Float32Array(points.count);
  const color = new THREE.Color();
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i) + 5, y = -points.getZ(i) + 35, s = field(x, y);
    points.setXYZ(i, x, s.elevation, -y);
    if (s.road) color.set("#b08a68");
    else if (s.pad) color.set(s.industrial ? "#9b8e7a" : "#a97c5d");
    else if (s.pit) {
      color.set(rockTones[Math.min(10, s.level)]);
      if (s.face < 0.15) color.lerp(new THREE.Color("#a3785e"), 0.24);
    } else color.set("#506039");
    color.multiplyScalar(0.79 + s.variation * 0.33 + noise(x * 0.47, y * 0.47) * 0.13);
    colors.set([color.r, color.g, color.b], i * 3);
    roadMask[i] = s.road || s.pad ? 1 : 0;
    uv.setXY(i, x * 0.3, y * 0.3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("roadMask", new THREE.BufferAttribute(roadMask, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function distantRidges(field: TerrainField): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(1100, 1100, 160, 160);
  geometry.rotateX(-Math.PI / 2);
  const p = geometry.getAttribute("position"), tint = new THREE.Color();
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + 5, y = -p.getZ(i) + 35;
    const outer = Math.min(1, Math.max(Math.abs(x - 5) - 145, Math.abs(y - 35) - 135) / 90);
    const h = field(x, y).elevation + Math.max(0, outer) * (20 + noise(x * 0.008, y * 0.01) * 70);
    p.setXYZ(i, x, h - 0.7, -y);
    tint.set("#52694c").multiplyScalar(0.72 + noise(x * 0.045, y * 0.045) * 0.45);
    colors.set([tint.r, tint.g, tint.b], i * 3);
  }
  const indices: number[] = [], original = geometry.getIndex()!;
  for (let i = 0; i < original.count; i += 3) {
    const a = original.getX(i), b = original.getX(i + 1), c = original.getX(i + 2);
    const x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3;
    const y = -(p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
    if (x > -155 && x < 165 && y > -115 && y < 185) continue;
    indices.push(a, b, c);
  }
  geometry.setIndex(indices);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.name = "forested-mountain-range";
  mesh.receiveShadow = true;
  return mesh;
}

function roadRibbon(points: THREE.Vector3[], width: number, offset = 0): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  let travelled = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length, nz = dx / length;
    if (i) travelled += p.distanceTo(points[i - 1]);
    for (const side of [-1, 1]) {
      positions.push(p.x + nx * (offset + side * width / 2), p.y, p.z + nz * (offset + side * width / 2));
      uvs.push(side < 0 ? 0 : 1, travelled / 3);
    }
    if (i) { const n = i * 2; indices.push(n - 2, n - 1, n, n - 1, n + 1, n); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function haulRoads(features: MapFeature[], field: TerrainField): THREE.Group {
  const root = new THREE.Group();
  root.name = "graded-switchback-roads";
  const grainMap = textureGrain();
  const dust = new THREE.MeshStandardMaterial({ color: "#ba9472", map: grainMap, roughness: 1, side: THREE.DoubleSide });
  const wheelMark = new THREE.MeshStandardMaterial({ color: "#765b47", transparent: true, opacity: 0.21,
    depthWrite: false, roughness: 1, side: THREE.DoubleSide });
  const bermMaterial = new THREE.MeshStandardMaterial({ color: "#9c8770", roughness: 1 });
  const bermPositions: { p: THREE.Vector3; heading: number; size: number }[] = [];
  for (const road of gradedRoads(features)) {
    const points = road.points.map((p, i) => new THREE.Vector3(p.x_m, road.elevations[i] + 0.1, -p.y_m));
    const mesh = new THREE.Mesh(roadRibbon(points, road.width), dust);
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const offset of [-0.82, -0.47, 0.47, 0.82]) {
      const tracks = points.map((p) => p.clone().add(new THREE.Vector3(0, 0.012, 0)));
      root.add(new THREE.Mesh(roadRibbon(tracks, 0.16, offset * road.width / 3), wheelMark));
    }
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
      distance += points[i].distanceTo(points[i - 1]);
      if (distance < 1.4) continue;
      distance = 0;
      const tangent = points[i].clone().sub(points[i - 1]).normalize();
      const offset = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(road.width / 2 + 0.18);
      const p = points[i].clone().add(offset);
      const surface = field(p.x, -p.z);
      if (surface.industrial) continue;
      p.y = surface.elevation + 0.18;
      bermPositions.push({ p, heading: Math.atan2(tangent.x, tangent.z), size: 0.28 + grain(i, 5) * 0.12 });
    }
  }
  if (bermPositions.length) {
    const berms = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), bermMaterial, bermPositions.length);
    const dummy = new THREE.Object3D();
    bermPositions.forEach(({ p, heading, size }, i) => {
      dummy.position.copy(p); dummy.rotation.set(0, heading, 0); dummy.scale.set(size, size * 0.7, size * 1.8);
      dummy.updateMatrix(); berms.setMatrixAt(i, dummy.matrix);
    });
    berms.receiveShadow = true;
    root.add(berms);
  } else bermMaterial.dispose();
  if (!root.children.length) { grainMap.dispose(); dust.dispose(); wheelMark.dispose(); }
  return root;
}

export function buildTerrain(features: MapFeature[]) {
  const field = createTerrainField(features), root = new THREE.Group();
  root.name = "bailadila-ten-bench-terrain";
  const loader = new THREE.TextureLoader();
  const map = loader.load("/textures/mine/Diffuse.jpg"), normal = loader.load("/textures/mine/nor_gl.jpg");
  for (const texture of [map, normal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map, normalMap: normal,
    normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.98 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute float roadMask; varying float vRoadMask;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>", "#include <begin_vertex>\nvRoadMask=roadMask;");
    shader.fragmentShader = "varying float vRoadMask;\n" + shader.fragmentShader.replace(
      "#include <map_fragment>", THREE.ShaderChunk.map_fragment.replace(
        "diffuseColor *= sampledDiffuseColor;",
        "diffuseColor *= mix(mix(vec4(0.8,0.8,0.8,1.0),sampledDiffuseColor,0.38), vec4(vec3(0.86 + sampledDiffuseColor.r * 0.14),1.0),vRoadMask);"));
  };
  const mesh = new THREE.Mesh(terrainGeometry(field), material);
  mesh.name = "excavated-rock-benches";
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  root.add(mesh, distantRidges(field), haulRoads(features, field));
  return { mesh: root, field };
}

export function buildVegetation(field: TerrainField): THREE.Group {
  const root = new THREE.Group(), placements: { x: number; y: number; h: number; r: number; seed: number }[] = [];
  root.name = "bailadila-broadleaf-forest";
  let seed = 0;
  for (let y = -108; y < 182; y += 3.4) for (let x = -153; x < 168; x += 3.4) {
    seed++;
    const px = x + (grain(seed, 13) - 0.5) * 3, py = y + (grain(seed, 19) - 0.5) * 3;
    const s = field(px, py), r = 1.1 + grain(seed, 37) * 1.45;
    if (s.pit || s.pad || s.industrial || s.road || s.edge < r + 1.4) continue;
    if (noise(px * 0.03, py * 0.03) < 0.22 && grain(seed, 42) > 0.45) continue;
    placements.push({ x: px, y: py, h: s.elevation, r, seed });
  }
  const crown = new THREE.IcosahedronGeometry(1, 1), p = crown.getAttribute("position");
  const colors = new Float32Array(p.count * 3), normal = crown.getAttribute("normal");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const roughness = 0.87 + grain(Math.round(x * 100 + z * 51), Math.round(y * 100)) * 0.26;
    p.setXYZ(i, x * roughness, y * roughness, z * roughness);
    const n = new THREE.Vector3(x, y, z).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    const shade = 0.56 + Math.max(0, y + 0.6) * 0.29;
    colors.set([shade, shade, shade], i * 3);
  }
  crown.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const foliage = textureGrain();
  foliage.repeat.set(4, 4);
  const canopy = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({
    vertexColors: true, map: foliage, bumpMap: foliage, bumpScale: 0.12, roughness: 1,
  }), placements.length * 3);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.23, 1, 5),
    new THREE.MeshStandardMaterial({ color: "#65533b", roughness: 1 }), placements.length);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  placements.forEach((tree, i) => {
    dummy.position.set(tree.x, tree.h + tree.r * 0.9, -tree.y);
    dummy.rotation.set(0, tree.seed, 0); dummy.scale.set(1, tree.r * 1.8, 1); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    for (let j = 0; j < 3; j++) {
      const angle = j * 2.1 + grain(tree.seed, 61) * 6;
      dummy.position.set(tree.x + Math.cos(angle) * tree.r * 0.44,
        tree.h + tree.r * (j === 0 ? 1.85 : 1.36), -tree.y + Math.sin(angle) * tree.r * 0.44);
      dummy.scale.set(tree.r * (j === 0 ? 0.93 : 0.82), tree.r * (0.8 + grain(tree.seed, j) * 0.3), tree.r * 0.9);
      dummy.rotation.set(grain(tree.seed, j) * 0.2, angle, 0); dummy.updateMatrix();
      canopy.setMatrixAt(i * 3 + j, dummy.matrix);
      tint.set(forestTones[Math.floor(grain(tree.seed, 47) * forestTones.length)]);
      tint.multiplyScalar(0.81 + grain(tree.seed, j + 8) * 0.35);
      canopy.setColorAt(i * 3 + j, tint);
    }
  });
  canopy.castShadow = true; canopy.receiveShadow = true;
  canopy.name = "dense-broadleaf-canopy";
  trunks.castShadow = true;
  root.add(canopy, trunks);
  root.userData.treeCount = placements.length;

  const stones: { x: number; y: number; h: number; r: number }[] = [];
  for (let i = 0; i < 9000; i++) {
    const x = -72 + grain(i, 80) * 117, y = -21 + grain(i, 81) * 109, s = field(x, y);
    if (s.road || s.pad || (!s.pit && s.edge > 3.5)) continue;
    if (s.face > 0.1 && grain(i, 5) > 0.25) continue;
    stones.push({ x, y, h: s.elevation, r: 0.08 + grain(i, 82) ** 2 * 0.58 });
  }
  const rubble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 }), stones.length);
  stones.forEach((stone, i) => {
    dummy.position.set(stone.x, stone.h + stone.r * 0.3, -stone.y);
    dummy.scale.set(stone.r, stone.r * 0.6, stone.r * 1.3); dummy.rotation.set(i, i * 0.4, 0);
    dummy.updateMatrix(); rubble.setMatrixAt(i, dummy.matrix);
    tint.set(i % 3 === 0 ? "#94775f" : "#73716c").multiplyScalar(0.7 + grain(i, 15) * 0.55);
    rubble.setColorAt(i, tint);
  });
  rubble.castShadow = true; rubble.receiveShadow = true; rubble.name = "bench-toe-blast-rubble";
  root.add(rubble);
  return root;
}
