import * as THREE from "three";
import { buildTruckMesh } from "../spatial/truckMesh";
import type { MapFeature } from "../types";
import { createTerrainField, grain, type TerrainField } from "./terrainField";

export function textureGrain(): THREE.DataTexture {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4,
        v = 155 + Math.round(grain(x, y) * 90);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
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

export function buildTerrain(features: MapFeature[]) {
  const field = createTerrainField(features);
  const geometry = new THREE.PlaneGeometry(160, 150, 256, 240);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv");
  const colors = new Float32Array(positions.count * 3),
    roadMask = new Float32Array(positions.count);
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + 5,
      y = -positions.getZ(i) + 26,
      s = field(x, y);
    positions.setXYZ(i, x, s.elevation, -y);
    color.set(
      s.road || s.pad
        ? "#b09a72"
        : s.pit
          ? ["#80694f", "#766b5d", "#a28c6e", "#726354", "#9c7455", "#625a50"][
              s.level
            ]
          : "#4b5934",
    );
    color.multiplyScalar(0.78 + s.variation * 0.43 + grain(x * 7, y * 7) * 0.1);
    colors.set([color.r, color.g, color.b], i * 3);
    roadMask[i] = s.road || s.pad ? 1 : 0;
    uv.setXY(i, x * 0.12, y * 0.12);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("roadMask", new THREE.BufferAttribute(roadMask, 1));
  geometry.computeVertexNormals();
  const loader = new THREE.TextureLoader();
  const map = loader.load("/textures/mine/Diffuse.jpg"),
    normal = loader.load("/textures/mine/nor_gl.jpg");
  for (const texture of [map, normal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughness: 1,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "attribute float roadMask; varying float vRoadMask;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvRoadMask=roadMask;",
      );
    shader.fragmentShader =
      "varying float vRoadMask;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        THREE.ShaderChunk.map_fragment.replace(
          "diffuseColor *= sampledDiffuseColor;",
          "diffuseColor *= mix(mix(vec4(0.65,0.65,0.65,1.0),sampledDiffuseColor,0.55), vec4(vec3(0.90 + sampledDiffuseColor.r * 0.10),1.0),vRoadMask);",
        ),
      );
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return { mesh, field };
}

export function buildVegetation(field: TerrainField): THREE.Group {
  const group = new THREE.Group(),
    placements: { x: number; y: number; h: number; r: number }[] = [];
  for (let i = 0; i < 3000 && placements.length < 320; i++) {
    const x = -69 + grain(i, 17) * 149,
      y = -43 + grain(i, 31) * 139,
      s = field(x, y);
    if (s.road || s.pit || s.pad || s.edge < 8) continue;
    placements.push({ x, y, h: s.elevation, r: 0.45 + grain(i, 71) * 0.65 });
  }
  const crown = new THREE.IcosahedronGeometry(1, 2),
    crownPoints = crown.getAttribute("position");
  for (let i = 0; i < crownPoints.count; i++) {
    const x = crownPoints.getX(i),
      y = crownPoints.getY(i),
      z = crownPoints.getZ(i);
    const r =
      0.88 + 0.25 * grain(Math.round(x * 100 + z * 71), Math.round(y * 100));
    crownPoints.setXYZ(i, x * r, y * r, z * r);
  }
  const crownNormals = crown.getAttribute("normal");
  for (let i = 0; i < crownPoints.count; i++) {
    const n = new THREE.Vector3()
      .fromBufferAttribute(crownPoints, i)
      .normalize();
    crownNormals.setXYZ(i, n.x, n.y, n.z);
  }
  const foliage = textureGrain();
  foliage.repeat.set(3, 3);
  const canopy = new THREE.InstancedMesh(
    crown,
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: foliage,
      bumpMap: foliage,
      bumpScale: 0.2,
      roughness: 1,
    }),
    placements.length * 3,
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.22, 2.4, 5),
    new THREE.MeshStandardMaterial({ color: "#5b4931", roughness: 1 }),
    placements.length,
  );
  const dummy = new THREE.Object3D(),
    tint = new THREE.Color();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.h + 1.1, -p.y);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    for (let j = 0; j < 3; j++) {
      dummy.position.set(
        p.x + (j - 1) * p.r * 0.55,
        p.h + 1.9 + p.r * (j === 1 ? 0.9 : 0.45),
        -p.y + (grain(i, j) - 0.5) * p.r,
      );
      dummy.scale.set(p.r, p.r * (0.9 + grain(i, 42) * 0.5), p.r);
      dummy.rotation.set(grain(i, j) * 0.4, grain(i, j + 20) * 6, 0);
      dummy.updateMatrix();
      canopy.setMatrixAt(i * 3 + j, dummy.matrix);
      tint.setHSL(
        0.24 + grain(i, 14) * 0.03,
        0.3 + grain(i, 37) * 0.2,
        0.1 + grain(i, j + 4) * 0.12,
      );
      canopy.setColorAt(i * 3 + j, tint);
    }
  });
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  trunks.castShadow = true;
  group.add(canopy, trunks);
  const stones = [];
  for (let i = 0; i < 1800; i++) {
    const x = -30 + grain(i, 80) * 72,
      y = -8 + grain(i, 81) * 70,
      s = field(x, y);
    if (s.road || s.pad || (!s.pit && s.edge > 3)) continue;
    stones.push({ x, y, h: s.elevation, r: 0.08 + grain(i, 82) * 0.3 });
  }
  const rubble = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: "#8d7c64", roughness: 1 }),
    stones.length,
  );
  stones.forEach((p, i) => {
    dummy.position.set(p.x, p.h + p.r * 0.3, -p.y);
    dummy.scale.set(p.r, p.r * 0.65, p.r * 1.3);
    dummy.rotation.set(i, i * 0.4, 0);
    dummy.updateMatrix();
    rubble.setMatrixAt(i, dummy.matrix);
  });
  rubble.receiveShadow = true;
  group.add(rubble);
  return group;
}

export function truckGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [],
    color = new THREE.Color();
  for (const face of buildTruckMesh())
    for (const surface of [face, ...face.details]) {
      color.set(surface.fill);
      for (let i = 1; i < surface.points.length - 1; i++)
        for (const p of [
          surface.points[0],
          surface.points[i],
          surface.points[i + 1],
        ]) {
          positions.push(p.x_m, p.z_m, -p.y_m);
          colors.push(color.r, color.g, color.b);
        }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function disposeScene(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        if (object instanceof THREE.InstancedMesh) object.dispose();
      }
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
