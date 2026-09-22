import * as THREE from "three";
import { truckGeometry } from "../twin/mineSceneGeometry";
import type { LidarEntity, LidarFrame, LidarPath } from "./lidarFrame";

export interface LidarRenderer {
  update: (frame: LidarFrame) => void;
  dispose: () => void;
}

const MAX_ROAD_POINTS = 3_000;
const MAX_RETURN_POINTS = 1_000;

const POINT_VERTEX = `
  varying vec3 vColor;
  uniform float uSize;

  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uSize * (220.0 / -mv.z), 1.2, 5.5);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAGMENT = `
  varying vec3 vColor;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    if (dot(point, point) > 0.25) discard;
    gl_FragColor = vec4(vColor, 0.92);
  }
`;

interface EntityItem {
  group: THREE.Group;
  box: THREE.LineSegments;
  vehicleMesh: THREE.Mesh | null;
}

function fillSolidColors(target: Float32Array, count: number, color: [number, number, number]) {
  for (let index = 0; index < count; index++) {
    target[index * 3] = color[0];
    target[index * 3 + 1] = color[1];
    target[index * 3 + 2] = color[2];
  }
}

export function createLidarRenderer(container: HTMLElement): LidarRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x050a12, 1);
  renderer.domElement.setAttribute(
    "aria-label",
    "Vehicle-centered LiDAR view with mapped road and tracked objects",
  );
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a12);
  scene.fog = new THREE.Fog(0x050a12, 35, 85);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 120);
  camera.position.set(0, 15, 12);
  camera.lookAt(0, 0, -18);

  // Subtle dark ground grid
  const gridHelper = new THREE.GridHelper(80, 40, 0x142838, 0x0c1822);
  gridHelper.position.set(0, 0, -10);
  scene.add(gridHelper);

  // Road point cloud (allocated once)
  const roadPositions = new Float32Array(MAX_ROAD_POINTS * 3);
  const roadColors = new Float32Array(MAX_ROAD_POINTS * 3);
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(roadPositions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  roadGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(roadColors, 3).setUsage(THREE.DynamicDrawUsage),
  );
  roadGeometry.setDrawRange(0, 0);

  const roadMaterial = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: { uSize: { value: 1.1 } },
    vertexColors: true,
    depthWrite: false,
    transparent: true,
  });
  const roadPoints = new THREE.Points(roadGeometry, roadMaterial);
  scene.add(roadPoints);

  // Return point cloud (allocated once)
  const returnPositions = new Float32Array(MAX_RETURN_POINTS * 3);
  const returnColors = new Float32Array(MAX_RETURN_POINTS * 3);
  const returnGeometry = new THREE.BufferGeometry();
  returnGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(returnPositions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  returnGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(returnColors, 3).setUsage(THREE.DynamicDrawUsage),
  );
  returnGeometry.setDrawRange(0, 0);

  const returnMaterial = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: { uSize: { value: 1.6 } },
    vertexColors: true,
    depthWrite: false,
    transparent: true,
  });
  const rangePoints = new THREE.Points(returnGeometry, returnMaterial);
  scene.add(rangePoints);

  const pathMaterial = new THREE.LineBasicMaterial({
    color: 0x1e7898,
    transparent: true,
    opacity: 0.65,
  });
  const boxMaterial = new THREE.LineBasicMaterial({
    color: 0x22ff44,
    transparent: true,
    opacity: 0.9,
  });
  const unitBoxGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const peerGeometry = truckGeometry();
  const peerMaterial = new THREE.MeshBasicMaterial({
    color: 0x1a885a,
    wireframe: true,
    transparent: true,
    opacity: 0.65,
  });

  // Ego vehicle marker at origin
  const egoWire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.4, 1.2, 2.6)),
    new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 }),
  );
  egoWire.position.set(0, 0.6, 0);
  scene.add(egoWire);

  const egoGeometry = truckGeometry();
  const egoMaterial = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    wireframe: true,
    transparent: true,
    opacity: 0.45,
  });
  const ego = new THREE.Mesh(egoGeometry, egoMaterial);
  ego.position.set(0, 0.02, 0);
  ego.scale.setScalar(1.05);
  scene.add(ego);

  const paths = new Map<string, THREE.Line>();
  const entities = new Map<string, EntityItem>();
  let disposed = false;
  let contextLost = false;
  let visible = true;
  let animationFrame = 0;

  const render = () => {
    animationFrame = 0;
    if (disposed || contextLost || !visible || document.hidden) return;
    renderer.render(scene, camera);
  };

  const requestRender = () => {
    if (disposed || contextLost || !visible || document.hidden || animationFrame) {
      return;
    }
    animationFrame = requestAnimationFrame(render);
  };

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestRender();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) requestRender();
    else if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  });
  intersectionObserver.observe(container);

  const onVisibilityChange = () => {
    if (document.hidden && animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    } else {
      requestRender();
    }
  };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  };
  const onContextRestored = () => {
    contextLost = false;
    requestRender();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

  const reconcilePaths = (nextPaths: LidarPath[]) => {
    const nextIds = new Set(nextPaths.map((path) => path.id));
    for (const [id, line] of paths) {
      if (nextIds.has(id)) continue;
      scene.remove(line);
      line.geometry.dispose();
      paths.delete(id);
    }

    for (const path of nextPaths) {
      let line = paths.get(path.id);
      const expectsLoop = path.closed;
      if (
        line &&
        ((expectsLoop && !(line instanceof THREE.LineLoop)) ||
          (!expectsLoop && line instanceof THREE.LineLoop))
      ) {
        scene.remove(line);
        line.geometry.dispose();
        paths.delete(path.id);
        line = undefined;
      }
      if (!line) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(path.positions, 3),
        );
        line = expectsLoop
          ? new THREE.LineLoop(geometry, pathMaterial)
          : new THREE.Line(geometry, pathMaterial);
        paths.set(path.id, line);
        scene.add(line);
      } else {
        const posAttr = line.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!posAttr || posAttr.count !== path.positions.length / 3) {
          line.geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(path.positions, 3),
          );
        } else {
          (posAttr.array as Float32Array).set(path.positions);
          posAttr.needsUpdate = true;
        }
      }
      line.geometry.computeBoundingSphere();
    }
  };

  const createEntity = (entity: LidarEntity): EntityItem => {
    const group = new THREE.Group();
    const box = new THREE.LineSegments(unitBoxGeometry, boxMaterial);
    box.scale.set(...entity.size);
    group.add(box);
    let vehicleMesh: THREE.Mesh | null = null;
    if (entity.kind === "vehicle") {
      vehicleMesh = new THREE.Mesh(peerGeometry, peerMaterial);
      vehicleMesh.scale.setScalar(1.05);
      group.add(vehicleMesh);
    }
    scene.add(group);
    return { group, box, vehicleMesh };
  };

  const reconcileEntities = (nextEntities: LidarEntity[]) => {
    const nextIds = new Set(nextEntities.map((entity) => entity.id));
    for (const [id, item] of entities) {
      if (nextIds.has(id)) continue;
      scene.remove(item.group);
      entities.delete(id);
    }

    for (const entity of nextEntities) {
      let item = entities.get(entity.id);
      if (!item) {
        item = createEntity(entity);
        entities.set(entity.id, item);
      }
      item.group.position.set(...entity.position);
      item.group.rotation.y = -entity.yawRad;
      item.box.scale.set(...entity.size);
    }
  };

  resize();

  return {
    update(frame) {
      if (disposed) return;

      const roadCount = Math.min(frame.roadPointCount, MAX_ROAD_POINTS);
      const roadPosAttr = roadGeometry.attributes.position as THREE.BufferAttribute;
      (roadPosAttr.array as Float32Array).set(
        frame.roadPositions.subarray(0, roadCount * 3),
      );
      roadPosAttr.needsUpdate = true;

      const roadColAttr = roadGeometry.attributes.color as THREE.BufferAttribute;
      fillSolidColors(roadColAttr.array as Float32Array, roadCount, [0.12, 0.48, 0.68]);
      roadColAttr.needsUpdate = true;

      roadGeometry.setDrawRange(0, roadCount);
      roadGeometry.computeBoundingSphere();

      const returnCount = Math.min(frame.returnCount, MAX_RETURN_POINTS);
      const retPosAttr = returnGeometry.attributes.position as THREE.BufferAttribute;
      (retPosAttr.array as Float32Array).set(
        frame.returnPositions.subarray(0, returnCount * 3),
      );
      retPosAttr.needsUpdate = true;

      const retColAttr = returnGeometry.attributes.color as THREE.BufferAttribute;
      (retColAttr.array as Float32Array).set(
        frame.returnColors.subarray(0, returnCount * 3),
      );
      retColAttr.needsUpdate = true;

      returnGeometry.setDrawRange(0, returnCount);
      returnGeometry.computeBoundingSphere();

      reconcilePaths(frame.paths);
      reconcileEntities(frame.entities);

      container.dataset.roadPoints = String(roadCount);
      container.dataset.returns = String(returnCount);
      container.dataset.entities = String(frame.entities.length);
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);

      for (const line of paths.values()) {
        scene.remove(line);
        line.geometry.dispose();
      }
      paths.clear();
      for (const item of entities.values()) scene.remove(item.group);
      entities.clear();

      roadGeometry.dispose();
      returnGeometry.dispose();
      roadMaterial.dispose();
      returnMaterial.dispose();
      pathMaterial.dispose();
      boxMaterial.dispose();
      unitBoxGeometry.dispose();
      peerGeometry.dispose();
      peerMaterial.dispose();
      egoGeometry.dispose();
      egoMaterial.dispose();
      gridHelper.geometry.dispose();
      (gridHelper.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
