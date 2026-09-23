import * as THREE from "three";
import { buildTruckMesh } from "./truckMesh";
// Renderer adapted from claude/nervous-gould-32361c, commit d70c1fb.
import type { LidarEntity, LidarFrame, LidarPath } from "./mappingFrame";

export interface LidarRenderer {
  update: (frame: LidarFrame) => void;
  dispose: () => void;
}

const MAX_ROAD_POINTS = 40_000;
const MAX_RETURN_POINTS = 36_000;
const SCAN_REVEAL_MS = 1700;

const POINT_VERTEX = `
  varying vec3 vColor;
  uniform float uSize;
  uniform float uScan;

  void main() {
    float band = max(0.0, 1.0 - abs(-position.z - uScan) / 1.8);
    vColor = color * (0.96 + band * 0.2);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uSize * (110.0 / -mv.z), 1.0, 3.0);
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
  scanMaterial: THREE.MeshStandardMaterial | null;
  scanStartedAt: number;
  volume: THREE.Mesh;
  target: THREE.Vector3;
  yawTarget: number;
}

function fillRoadColors(target: Float32Array, positions: Float32Array, count: number) {
  const color = new THREE.Color();
  for (let index = 0; index < count; index++) {
    const height = positions[index * 3 + 1];
    const distance = Math.max(0, -positions[index * 3 + 2]);
    const t = Math.min(1, height / 5 + distance / 85);
    color.setHSL(0.72 - t * 0.68, 0.88, 0.59);
    target[index * 3] = color.r;
    target[index * 3 + 1] = color.g;
    target[index * 3 + 2] = color.b;
  }
}

function solidTruckGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const color = new THREE.Color();
  // Include the hopper and front wheels omitted by the mine's chassis-only mesh.
  for (const face of buildTruckMesh()) {
    if (face.part === "truck-ore-cargo") continue;
    for (const surface of [face, ...face.details]) {
      color.set(surface.fill);
      for (let i = 1; i < surface.points.length - 1; i++) {
        for (const point of [surface.points[0], surface.points[i], surface.points[i + 1]]) {
          positions.push(point.x_m, point.z_m, -point.y_m);
          colors.push(color.r, color.g, color.b);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -geometry.boundingBox!.min.y, -center.z);
  geometry.computeBoundingBox();
  return geometry;
}

export function createLidarRenderer(container: HTMLElement): LidarRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setClearColor(0x050509, 1);
  renderer.domElement.setAttribute(
    "aria-label",
    "Spatial point cloud with surrounding objects",
  );
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050509);
  scene.fog = new THREE.Fog(0x050509, 40, 95);
  scene.add(new THREE.HemisphereLight(0xf0f5ff, 0x59616a, 2.1));
  const keyLight = new THREE.DirectionalLight(0xfff0d3, 2.7);
  keyLight.position.set(-8, 14, 8);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xc8e3ff, 1.1);
  fillLight.position.set(8, 5, -10);
  scene.add(fillLight);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.03, 160);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0.4, -17);

  // Subtle dark ground grid
  const gridHelper = new THREE.GridHelper(100, 50, 0x242633, 0x141620);
  gridHelper.position.set(0, -0.025, -10);
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
    uniforms: { uSize: { value: 0.7 }, uScan: { value: -100 } },
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
    uniforms: { uSize: { value: 0.7 }, uScan: { value: -100 } },
    vertexColors: true,
    depthWrite: false,
    transparent: true,
  });
  const rangePoints = new THREE.Points(returnGeometry, returnMaterial);
  scene.add(rangePoints);

  const pathMaterial = new THREE.LineBasicMaterial({
    color: 0x1e7898,
    transparent: true,
    opacity: 0.16,
  });
  const boxMaterial = new THREE.LineBasicMaterial({
    color: 0x22ff44,
    transparent: true,
    opacity: 0.9,
  });
  const unitBoxGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const vehicleGeometry = solidTruckGeometry();
  const vehicleMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.74,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const vehicleBounds = vehicleGeometry.boundingBox!.getSize(new THREE.Vector3());
  const volumeMaterial = new THREE.MeshBasicMaterial({ color: 0x55ff55, transparent: true,
    opacity: 0.045, depthWrite: false });
  const volumeGeometry = new THREE.BoxGeometry(1, 1, 1);

  const ego = new THREE.Mesh(vehicleGeometry, vehicleMaterial);
  ego.position.set(0, 0.02, 0);
  scene.add(ego);

  const paths = new Map<string, THREE.Line>();
  const entities = new Map<string, EntityItem>();
  let disposed = false;
  let contextLost = false;
  let visible = true;
  let animationFrame = 0;
  let previewActive = false;
  let source: LidarFrame["source"] | null = null;
  let animateUntil = 0;
  let previousRenderAt = 0;
  let previousRoadPositions: Float32Array | null = null;
  let previousRoadColors: Float32Array | undefined;
  let previousRoadCount = -1;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const render = (time: number) => {
    animationFrame = 0;
    if (disposed || contextLost || !visible || document.hidden) return;
    if (time - previousRenderAt < 32 && !reducedMotion.matches) {
      requestRender();
      return;
    }
    const alpha = reducedMotion.matches || time >= animateUntil ? 1
      : 1 - Math.exp(-Math.min(100, time - previousRenderAt) / 30);
    previousRenderAt = time;
    for (const item of entities.values()) {
      item.group.position.lerp(item.target, alpha);
      const yawDelta = Math.atan2(Math.sin(item.yawTarget - item.group.rotation.y),
        Math.cos(item.yawTarget - item.group.rotation.y));
      item.group.rotation.y += yawDelta * alpha;
      if (item.scanMaterial) {
        const progress = Math.min(1, Math.max(0, (time - item.scanStartedAt) / SCAN_REVEAL_MS));
        const smooth = progress * progress * (3 - 2 * progress);
        item.scanMaterial.opacity = (reducedMotion.matches ? 1 : smooth) * 0.86;
      }
    }
    const scan = previewActive && !reducedMotion.matches ? (time / 160) % 55 - 10 : -100;
    roadMaterial.uniforms.uScan.value = scan;
    returnMaterial.uniforms.uScan.value = scan;
    renderer.render(scene, camera);
    if (!reducedMotion.matches && (previewActive || time < animateUntil)) requestRender();
  };

  const requestRender = () => {
    if (disposed || contextLost || !visible || document.hidden || animationFrame) {
      return;
    }
    animationFrame = requestAnimationFrame(render);
  };

  const frameCamera = () => {
    const close = source === "MEASURED" || source === "WAITING";
    const fit = close ? Math.max(1, 1.05 / camera.aspect) : 1;
    camera.position.set(close ? 3.5 * fit : 0, close ? 5 * fit : 4.4, close ? 5.5 * fit : 9.5);
    camera.lookAt(0, 0, close ? 0 : -14);
  };

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    frameCamera();
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
  reducedMotion.addEventListener("change", requestRender);
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
          line.geometry.dispose();
          line.geometry = new THREE.BufferGeometry();
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
    box.visible = entity.kind !== "vehicle" && entity.kind !== "scanned_vehicle";
    group.add(box);
    const volume = new THREE.Mesh(volumeGeometry, volumeMaterial);
    volume.scale.set(...entity.size);
    volume.visible = entity.kind !== "vehicle" && entity.kind !== "scanned_vehicle";
    group.add(volume);
    let vehicleMesh: THREE.Mesh | null = null;
    let scanMaterial: THREE.MeshStandardMaterial | null = null;
    if (entity.kind === "vehicle" || entity.kind === "scanned_vehicle") {
      if (entity.kind === "scanned_vehicle") {
        scanMaterial = vehicleMaterial.clone();
        scanMaterial.transparent = true;
        scanMaterial.depthWrite = false;
        scanMaterial.opacity = reducedMotion.matches ? 0.86 : 0;
      }
      vehicleMesh = new THREE.Mesh(vehicleGeometry, scanMaterial ?? vehicleMaterial);
      vehicleMesh.scale.set(entity.size[0] / vehicleBounds.x, entity.size[1] / vehicleBounds.y,
        entity.size[2] / vehicleBounds.z);
      vehicleMesh.position.y = -entity.size[1] / 2;
      group.add(vehicleMesh);
    }
    scene.add(group);
    group.position.set(...entity.position);
    group.rotation.y = -entity.yawRad;
    return { group, box, vehicleMesh, scanMaterial, scanStartedAt: performance.now(),
      volume, target: group.position.clone(), yawTarget: -entity.yawRad };
  };

  const reconcileEntities = (nextEntities: LidarEntity[]) => {
    const nextIds = new Set(nextEntities.map((entity) => entity.id));
    for (const [id, item] of entities) {
      if (nextIds.has(id)) continue;
      scene.remove(item.group);
      item.scanMaterial?.dispose();
      entities.delete(id);
    }

    for (const entity of nextEntities) {
      let item = entities.get(entity.id);
      if (!item) {
        item = createEntity(entity);
        entities.set(entity.id, item);
      }
      item.target.set(...entity.position);
      item.yawTarget = -entity.yawRad;
      item.box.scale.set(...entity.size);
      item.volume.scale.set(...entity.size);
      if (item.vehicleMesh) {
        item.vehicleMesh.scale.set(entity.size[0] / vehicleBounds.x, entity.size[1] / vehicleBounds.y,
          entity.size[2] / vehicleBounds.z);
        item.vehicleMesh.position.y = -entity.size[1] / 2;
      }
    }
    animateUntil = Math.max(performance.now() + 120,
      ...Array.from(entities.values(), item => item.scanMaterial ? item.scanStartedAt + SCAN_REVEAL_MS : 0));
  };

  resize();

  return {
    update(frame) {
      if (disposed) return;
      previewActive = frame.source === "SIMULATED_PREVIEW";
      if (source !== frame.source) {
        source = frame.source;
        const close = source === "MEASURED" || source === "WAITING";
        frameCamera();
        gridHelper.visible = source !== "REFERENCE_SIMULATION";
        gridHelper.scale.setScalar(close ? 0.1 : 1);
        gridHelper.position.z = close ? 0 : -10;
        returnMaterial.uniforms.uSize.value = close ? 0.42 : 1.0;
        roadMaterial.uniforms.uSize.value = close ? 0.7 : 1.0;
      }
      ego.scale.set(frame.egoSize[0] / vehicleBounds.x, frame.egoSize[1] / vehicleBounds.y,
        frame.egoSize[2] / vehicleBounds.z);
      roadPoints.position.set(...(frame.roadTransform?.position ?? [0, 0, 0]));
      roadPoints.rotation.y = frame.roadTransform?.yawRad ?? 0;

      const roadCount = Math.min(frame.roadPointCount, MAX_ROAD_POINTS);
      if (previousRoadPositions !== frame.roadPositions || previousRoadColors !== frame.roadColors ||
        previousRoadCount !== roadCount) {
        const roadPosAttr = roadGeometry.attributes.position as THREE.BufferAttribute;
        (roadPosAttr.array as Float32Array).set(frame.roadPositions.subarray(0, roadCount * 3));
        roadPosAttr.needsUpdate = true;
        const roadColAttr = roadGeometry.attributes.color as THREE.BufferAttribute;
        if (frame.roadColors) (roadColAttr.array as Float32Array).set(frame.roadColors.subarray(0, roadCount * 3));
        else fillRoadColors(roadColAttr.array as Float32Array, frame.roadPositions, roadCount);
        roadColAttr.needsUpdate = true;
        roadGeometry.computeBoundingSphere();
        previousRoadPositions = frame.roadPositions;
        previousRoadColors = frame.roadColors;
        previousRoadCount = roadCount;
      }
      roadGeometry.setDrawRange(0, roadCount);

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
      container.dataset.source = frame.source;
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", requestRender);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);

      for (const line of paths.values()) {
        scene.remove(line);
        line.geometry.dispose();
      }
      paths.clear();
      for (const item of entities.values()) {
        scene.remove(item.group);
        item.scanMaterial?.dispose();
      }
      entities.clear();

      roadGeometry.dispose();
      returnGeometry.dispose();
      roadMaterial.dispose();
      returnMaterial.dispose();
      pathMaterial.dispose();
      boxMaterial.dispose();
      unitBoxGeometry.dispose();
      vehicleGeometry.dispose();
      vehicleMaterial.dispose();
      volumeMaterial.dispose();
      volumeGeometry.dispose();
      gridHelper.geometry.dispose();
      (gridHelper.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
