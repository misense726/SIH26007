import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MapFeature, HaulRouteState } from "../types";
import type { SupervisorVehicle } from "../supervisor/supervisorViewModel";
import {
  buildTerrain,
  buildVegetation,
  truckGeometry,
  disposeScene,
} from "./mineSceneGeometry";
import { buildInfrastructure } from "./mineInfrastructure";

export interface MineFrame {
  vehicles: SupervisorVehicle[];
  haul?: HaulRouteState | null;
  selected?: string | null;
}
export interface MineRenderer {
  update: (frame: MineFrame) => void;
  zoom: (factor: number) => void;
  fit: () => void;
  dispose: () => void;
  focus: (target: "pit" | "truck" | "crusher") => void;
}

export function createMineRenderer(
  container: HTMLElement,
  features: MapFeature[],
  select: (id: string) => void,
): MineRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute(
    "aria-label",
    "Detailed 3D mine terrain with moving fleet vehicles",
  );
  container.appendChild(renderer.domElement);
  container.dataset.context = "ready";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#b3c0b8");
  scene.fog = new THREE.Fog("#b3c0b8", 160, 260);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.2, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 12;
  controls.maxDistance = 175;
  controls.target.set(4, 2, -26);
  let followingTruck = false;
  const stopFollowing = () => {
    followingTruck = false;
  };
  controls.addEventListener("start", stopFollowing);
  const fit = () => {
    followingTruck = false;
    controls.target.set(12, 2, -25);
    camera.position.set(67, 95, -79);
    controls.update();
  };
  fit();
  const hemi = new THREE.HemisphereLight("#d9edff", "#55503c", 2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff0d4", 3.1);
  sun.position.set(-45, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -85;
  sun.shadow.camera.right = 85;
  sun.shadow.camera.top = 85;
  sun.shadow.camera.bottom = -85;
  sun.shadow.camera.far = 240;
  sun.shadow.normalBias = 0.15;
  sun.shadow.bias = -0.0002;
  scene.add(sun);
  const { mesh: terrain, field } = buildTerrain(features);
  scene.add(
    terrain,
    buildVegetation(field),
    buildInfrastructure(features, field),
  );
  const geometry = truckGeometry(),
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.67,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
  const trucks = new Map<
    string,
    {
      mesh: THREE.Mesh;
      label: HTMLButtonElement;
      target: THREE.Vector3;
      heading: number;
    }
  >();
  const labels = document.createElement("div");
  labels.className = "mine-scene-labels";
  container.appendChild(labels);
  const siteLabels = features
    .filter(
      (f) => f.feature_type === "START" || f.feature_type === "DESTINATION",
    )
    .map((f) => {
      const p = f.points[0],
        x = p.x_m + (f.feature_type === "DESTINATION" ? 7 : 0);
      const label = document.createElement("span");
      label.className = "mine-site-label";
      label.textContent =
        f.feature_type === "START" ? "Mining area" : "Crusher / unloading";
      labels.appendChild(label);
      return {
        label,
        position: new THREE.Vector3(x, field(x, p.y_m).elevation + 6, -p.y_m),
      };
    });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.65, 1.78, 48),
    new THREE.MeshBasicMaterial({
      color: "#77d5ff",
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.32, 1),
    new THREE.MeshStandardMaterial({ color: "#958570", roughness: 1 }),
  );
  rock.castShadow = true;
  scene.add(rock);
  let current: MineFrame = { vehicles: [] },
    frameId = 0,
    last = 0,
    disposed = false,
    visible = true;
  const projected = new THREE.Vector3();
  const followOffset = new THREE.Vector3();
  function update(frame: MineFrame) {
    renderer.shadowMap.needsUpdate = true;
    current = frame;
    const ids = new Set(frame.vehicles.map((v) => v.vehicleId));
    for (const [id, item] of trucks)
      if (!ids.has(id)) {
        scene.remove(item.mesh);
        item.label.remove();
        trucks.delete(id);
      }
    for (const v of frame.vehicles) {
      let item = trucks.get(v.vehicleId);
      if (!item) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(v.xM, field(v.xM, v.yM).elevation, -v.yM);
        scene.add(mesh);
        const label = document.createElement("button");
        label.type = "button";
        label.textContent = v.vehicleId;
        label.setAttribute("aria-label", `${v.vehicleId}. View details`);
        label.onclick = () => select(v.vehicleId);
        labels.appendChild(label);
        item = { mesh, label, target: mesh.position.clone(), heading: 0 };
        trucks.set(v.vehicleId, item);
      }
      item.target.set(v.xM, field(v.xM, v.yM).elevation + 0.06, -v.yM);
      item.heading = (-v.headingDeg * Math.PI) / 180;
      item.label.dataset.selected = String(frame.selected === v.vehicleId);
    }
    rock.visible = Boolean(frame.haul?.obstacle);
    if (frame.haul?.obstacle) {
      const p = frame.haul.obstacle;
      rock.position.set(p.x_m, field(p.x_m, p.y_m).elevation + 0.15, -p.y_m);
    }
  }
  function resize() {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 1.5, Math.sqrt(2_000_000 / (w * h))),
    );
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(20)) *
            Math.max(1, 1.4 / camera.aspect),
        ),
    );
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const intersection = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
  });
  intersection.observe(container);
  function render(now: number) {
    if (disposed) return;
    frameId = requestAnimationFrame(render);
    if (document.hidden || !visible || now - last < 1000 / 30) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (followingTruck) {
      const primary = current.vehicles.find((v) => v.isPrimary);
      const truck = primary && trucks.get(primary.vehicleId);
      if (truck) {
        followOffset.copy(truck.mesh.position).sub(controls.target);
        camera.position.add(followOffset);
        controls.target.copy(truck.mesh.position);
      }
    }
    controls.update();
    ring.visible = false;
    for (const [id, item] of trucks) {
      if (item.mesh.position.distanceTo(item.target) > 6)
        item.mesh.position.copy(item.target);
      else item.mesh.position.lerp(item.target, 1 - Math.exp(-dt * 18));
      const delta =
        THREE.MathUtils.euclideanModulo(
          item.heading - item.mesh.rotation.y + Math.PI,
          Math.PI * 2,
        ) - Math.PI;
      item.mesh.rotation.y += delta * (1 - Math.exp(-dt * 16));
      projected.copy(item.mesh.position);
      projected.y += 2;
      projected.project(camera);
      const inFrame =
        projected.z < 1 &&
        Math.abs(projected.x) < 1.05 &&
        Math.abs(projected.y) < 1.05;
      item.label.hidden = !inFrame;
      item.label.style.transform = `translate(${(projected.x * 0.5 + 0.5) * container.clientWidth}px,${(-projected.y * 0.5 + 0.5) * container.clientHeight}px) translate(-50%,-100%)`;
      if (id === current.selected) {
        ring.visible = true;
        ring.position.copy(item.mesh.position);
        ring.position.y += 0.1;
      }
    }
    if (!current.selected) ring.visible = false;
    for (const site of siteLabels) {
      projected.copy(site.position).project(camera);
      site.label.hidden =
        projected.z > 1 ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1;
      site.label.style.transform = `translate(${(projected.x * 0.5 + 0.5) * container.clientWidth}px,${(-projected.y * 0.5 + 0.5) * container.clientHeight}px) translate(-50%,-100%)`;
    }
    renderer.render(scene, camera);
    container.dataset.drawCalls = String(renderer.info.render.calls);
    container.dataset.triangles = String(renderer.info.render.triangles);
    container.dataset.geometries = String(renderer.info.memory.geometries);
    container.dataset.textures = String(renderer.info.memory.textures);
  }
  frameId = requestAnimationFrame(render);
  const lost = (event: Event) => {
    event.preventDefault();
    container.dataset.context = "lost";
  };
  const restored = () => {
    container.dataset.context = "ready";
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  renderer.domElement.addEventListener("webglcontextrestored", restored);
  return {
    update,
    fit,
    focus: (target) => {
      followingTruck = target === "truck";
      const point =
        target === "truck" ? current.vehicles.find((v) => v.isPrimary) : null;
      const crusher = features.find((f) => f.feature_type === "DESTINATION")
        ?.points[0];
      const x =
        point?.xM ?? (target === "crusher" ? (crusher?.x_m ?? 32) + 13 : 4);
      const y =
        point?.yM ?? (target === "crusher" ? (crusher?.y_m ?? 44) - 7 : 30);
      const h = field(x, y).elevation,
        d = target === "truck" ? 11 : target === "crusher" ? 34 : 48;
      controls.target.set(x, h, -y);
      camera.position.set(x + d * 0.7, h + d, -y + d * 0.65);
      controls.update();
    },
    zoom: (factor) => {
      camera.position
        .sub(controls.target)
        .multiplyScalar(factor)
        .add(controls.target);
      controls.update();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      intersection.disconnect();
      controls.removeEventListener("start", stopFollowing);
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("webglcontextrestored", restored);
      labels.remove();
      const hadTrucks = trucks.size > 0;
      trucks.clear();
      disposeScene(scene);
      if (!hadTrucks) {
        geometry.dispose();
        material.dispose();
      }
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      scene.clear();
    },
  };
}
