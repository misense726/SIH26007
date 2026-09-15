import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MapFeature, HaulRouteState } from "../types";
import type { SupervisorVehicle } from "../supervisor/supervisorViewModel";
import {
  buildTerrain,
  buildVegetation,
  truckGeometry,
  dumpBedGeometry,
  frontWheelGeometry,
  oreCargoGeometry,
  oreChuteGeometry,
  oreRockGeometry,
  TRUCK_HINGE_Y,
  TRUCK_HINGE_Z,
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

interface TruckItem {
  mesh: THREE.Mesh;
  label: HTMLButtonElement;
  target: THREE.Vector3;
  heading: number;
  speed: number;
  currentHeading: number;
  steerAngle: number;
  pitch: number;
  roll: number;
  dumpBedPivot?: THREE.Group;
  oreCargo?: THREE.Mesh;
  hydraulicLeft?: THREE.Mesh;
  hydraulicRight?: THREE.Mesh;
  frontWheelLeft?: THREE.Group;
  frontWheelRight?: THREE.Group;
  reverseLamps?: THREE.Mesh;
  crusherPhase: "none" | "reverse" | "hoist" | "dump" | "lower" | "forward";
  crusherTimer: number;
  dumpAngle: number;
  oreLevel: number;
  dockOffset: THREE.Vector3;
  oreChute?: THREE.Mesh;
  boulders?: THREE.Mesh[];
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
    requestRender();
  };
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
  const crusherFeature = features.find(
    (f) => f.feature_type === "DESTINATION",
  )?.points[0];
  const crusherX = crusherFeature ? crusherFeature.x_m : 32.0;
  const crusherY = crusherFeature ? crusherFeature.y_m : 44.0;

  const geometry = truckGeometry(),
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.67,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
  const oreMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.22,
    side: THREE.DoubleSide,
  });
  const hydraulicMaterial = new THREE.MeshStandardMaterial({
    color: "#b4bec4",
    metalness: 0.85,
    roughness: 0.25,
  });
  const reverseLampMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
  });

  const trucks = new Map<string, TruckItem>();
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
    frameId: number | null = null,
    last = 0,
    animationLast: number | null = null,
    disposed = false,
    contextLost = false,
    visible = false;
  const canRender = () => !disposed && !contextLost && !document.hidden && visible;
  function requestRender() {
    if (canRender() && frameId === null)
      frameId = requestAnimationFrame(render);
  }
  function pause() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    last = 0;
    animationLast = null;
  }
  function syncVisibility() {
    if (canRender()) requestRender();
    else pause();
  }
  controls.addEventListener("change", requestRender);
  document.addEventListener("visibilitychange", syncVisibility);
  const projected = new THREE.Vector3();
  const followOffset = new THREE.Vector3();
  function update(frame: MineFrame) {
    if (disposed) return;
    requestRender();
    renderer.shadowMap.needsUpdate = true;
    current = frame;
    const ids = new Set(frame.vehicles.map((v) => v.vehicleId));
    for (const [id, item] of trucks)
      if (!ids.has(id)) {
        scene.remove(item.mesh);
        if (item.oreChute) scene.remove(item.oreChute);
        if (item.boulders) item.boulders.forEach((b) => scene.remove(b));
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

        let dumpBedPivot: THREE.Group | undefined;
        let oreCargo: THREE.Mesh | undefined;
        let hydraulicLeft: THREE.Mesh | undefined;
        let hydraulicRight: THREE.Mesh | undefined;
        let frontWheelLeft: THREE.Group | undefined;
        let frontWheelRight: THREE.Group | undefined;
        let reverseLamps: THREE.Mesh | undefined;
        let oreChute: THREE.Mesh | undefined;
        let boulders: THREE.Mesh[] | undefined;

        if (typeof dumpBedGeometry === "function") {
          const dumpGeom = dumpBedGeometry();
          const oreGeom = oreCargoGeometry();
          const leftWheelGeom = frontWheelGeometry(true);
          const rightWheelGeom = frontWheelGeometry(false);

          dumpBedPivot = new THREE.Group();
          dumpBedPivot.position.set(0, TRUCK_HINGE_Y, TRUCK_HINGE_Z);

          const dumpBedMesh = new THREE.Mesh(dumpGeom, material);
          dumpBedMesh.castShadow = true;
          dumpBedMesh.receiveShadow = true;
          dumpBedPivot.add(dumpBedMesh);

          oreCargo = new THREE.Mesh(oreGeom, oreMaterial);
          oreCargo.castShadow = true;
          dumpBedPivot.add(oreCargo);

          mesh.add(dumpBedPivot);

          frontWheelLeft = new THREE.Group();
          frontWheelLeft.position.set(-0.66, 0.35, -0.77);
          const fwlMesh = new THREE.Mesh(leftWheelGeom, material);
          fwlMesh.castShadow = true;
          frontWheelLeft.add(fwlMesh);
          mesh.add(frontWheelLeft);

          frontWheelRight = new THREE.Group();
          frontWheelRight.position.set(0.66, 0.35, -0.77);
          const fwrMesh = new THREE.Mesh(rightWheelGeom, material);
          fwrMesh.castShadow = true;
          frontWheelRight.add(fwrMesh);
          mesh.add(frontWheelRight);

          const cylGeom = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);
          hydraulicLeft = new THREE.Mesh(cylGeom, hydraulicMaterial);
          hydraulicRight = new THREE.Mesh(cylGeom, hydraulicMaterial);
          hydraulicLeft.castShadow = true;
          hydraulicRight.castShadow = true;
          mesh.add(hydraulicLeft, hydraulicRight);

          const lampGeom = new THREE.PlaneGeometry(0.12, 0.07);
          reverseLamps = new THREE.Mesh(lampGeom, reverseLampMaterial);
          reverseLamps.position.set(0, 0.46, 1.455);
          reverseLamps.visible = false;
          mesh.add(reverseLamps);

          const chuteGeom = oreChuteGeometry();
          oreChute = new THREE.Mesh(chuteGeom, oreMaterial);
          oreChute.castShadow = true;
          oreChute.visible = false;
          scene.add(oreChute);

          boulders = [];
          for (let bIdx = 0; bIdx < 8; bIdx++) {
            const rockGeom = oreRockGeometry(bIdx);
            const boulder = new THREE.Mesh(rockGeom, oreMaterial);
            boulder.castShadow = true;
            boulder.visible = false;
            scene.add(boulder);
            boulders.push(boulder);
          }
        }

        const label = document.createElement("button");
        label.type = "button";
        label.textContent = v.vehicleId;
        label.setAttribute("aria-label", `${v.vehicleId}. View details`);
        label.onclick = () => select(v.vehicleId);
        labels.appendChild(label);
        item = {
          mesh,
          label,
          target: mesh.position.clone(),
          heading: (-v.headingDeg * Math.PI) / 180,
          speed: v.speedMps,
          currentHeading: (-v.headingDeg * Math.PI) / 180,
          steerAngle: 0,
          pitch: 0,
          roll: 0,
          dumpBedPivot,
          oreCargo,
          hydraulicLeft,
          hydraulicRight,
          frontWheelLeft,
          frontWheelRight,
          reverseLamps,
          crusherPhase: "none",
          crusherTimer: 0,
          dumpAngle: 0,
          oreLevel: 1.0,
          dockOffset: new THREE.Vector3(),
          oreChute,
          boulders,
        };
        trucks.set(v.vehicleId, item);
      }
      item.target.set(v.xM, field(v.xM, v.yM).elevation + 0.06, -v.yM);
      item.heading = (-v.headingDeg * Math.PI) / 180;
      item.speed = v.speedMps;
      item.label.dataset.selected = String(frame.selected === v.vehicleId);

      // Check crusher proximity and unloading state
      const distToCrusher = Math.hypot(v.xM - crusherX, v.yM - crusherY);
      const isUnloading =
        distToCrusher < 3.5 &&
        (v.speedMps < 0.35 ||
          Boolean(frame.haul?.next_instruction?.toLowerCase().includes("crusher")) ||
          frame.haul?.phase === "ARRIVED");

      if (isUnloading && item.crusherPhase === "none" && item.oreLevel > 0.4) {
        item.crusherPhase = "reverse";
        item.crusherTimer = 0;
      } else if (!isUnloading && distToCrusher > 4.5 && item.crusherPhase !== "none") {
        item.crusherPhase = "none";
        item.dockOffset.set(0, 0, 0);
        item.dumpAngle = 0;
        item.oreLevel = 0.0;
        if (item.oreChute) item.oreChute.visible = false;
        if (item.boulders) item.boulders.forEach((b) => (b.visible = false));
        if (item.reverseLamps) item.reverseLamps.visible = false;
      }

      // After dumping, return trip to the mine loading bay must have an empty bed
      if (
        v.isPrimary &&
        frame.haul?.destination === "Mine loading bay" &&
        item.crusherPhase === "none"
      ) {
        item.oreLevel = 0.0;
      }

      // Refill cargo only when loaded at mine loading bay for a new trip
      const distToMine = Math.hypot(v.xM, v.yM);
      if (
        distToMine < 5.0 &&
        (frame.haul?.destination === "Dump point" || v.speedMps < 0.2)
      ) {
        item.oreLevel = 1.0;
      }
    }
    rock.visible = Boolean(frame.haul?.obstacle);
    if (frame.haul?.obstacle) {
      const p = frame.haul.obstacle;
      rock.position.set(p.x_m, field(p.x_m, p.y_m).elevation + 0.15, -p.y_m);
    }
  }
  function resize() {
    if (disposed) return;
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
    requestRender();
  }
  fit();
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const intersection = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry || disposed) return;
    visible = entry.isIntersecting;
    syncVisibility();
  });
  intersection.observe(container);
  function render(now: number) {
    frameId = null;
    if (!canRender()) {
      pause();
      return;
    }
    if (now - last < 1000 / 30) {
      requestRender();
      return;
    }
    // Resuming from suspension or idle gets one normal step, not elapsed wall time.
    const dt =
      animationLast === null
        ? 1 / 30
        : Math.min(0.1, (now - animationLast) / 1000);
    last = animationLast = now;
    let moving = false;
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
      const distance = item.mesh.position.distanceTo(item.target);
      // One final frame also lets the follow camera reach the snapped pose.
      if (distance > 0) moving = true;
      if (distance > 6 || distance <= 0.001)
        item.mesh.position.copy(item.target);
      else item.mesh.position.lerp(item.target, 1 - Math.exp(-dt * 18));

      // 1. Crusher Unloading Animation Sequence
      if (item.crusherPhase !== "none") {
        moving = true;
        item.crusherTimer += dt;
        const t = item.crusherTimer;

        if (item.crusherPhase === "reverse") {
          // Reversing backward into crusher hopper opening
          const p = Math.min(1.0, t / 1.2);
          const ease = p * p * (3 - 2 * p);
          item.dockOffset.set(ease * 2.2, 0, -ease * 1.5);
          item.currentHeading = THREE.MathUtils.lerp(item.currentHeading, 2.35, ease * 0.15);
          if (item.reverseLamps) item.reverseLamps.visible = true;
          if (t >= 1.2) item.crusherPhase = "hoist";
        } else if (item.crusherPhase === "hoist") {
          // Hoisting dump bed upward
          const hoistT = t - 1.2;
          const p = Math.min(1.0, hoistT / 1.4);
          const ease = p * p * (3 - 2 * p);
          item.dumpAngle = ease * 1.01;
          if (hoistT >= 1.4) item.crusherPhase = "dump";
        } else if (item.crusherPhase === "dump") {
          // Pouring heavy iron ore and rock boulders
          const dumpT = t - 2.6;
          item.dumpAngle = 1.01;
          const emptyP = Math.min(1.0, dumpT / 1.8);
          item.oreLevel = Math.max(0.0, 1.0 - emptyP);

          if (item.oreChute) {
            item.oreChute.visible = true;
            item.oreChute.position.set(34.2, field(36, 45).elevation + 4.3, -45.6);
            item.oreChute.rotation.y = 0.8;
            const pulse = 1.0 + Math.sin(dumpT * 20) * 0.06;
            item.oreChute.scale.set(pulse, Math.min(1.0, dumpT * 3.5), pulse);
          }

          if (item.boulders) {
            const hTop = field(36, 45).elevation + 4.4;
            const hBottom = field(36, 45).elevation + 3.2;
            item.boulders.forEach((rock, bIdx) => {
              rock.visible = true;
              const rockPhase = (dumpT * 1.8 + bIdx * 0.14) % 1.0;
              const startX = 34.0 + ((bIdx % 3) - 1) * 0.22;
              const startY = hTop;
              const startZ = -45.4 + ((bIdx % 2) - 0.5) * 0.2;
              const endX = 35.5 + (((bIdx * 7) % 5) - 2) * 0.15;
              const endZ = -46.0 + (((bIdx * 3) % 5) - 2) * 0.15;

              rock.position.x = THREE.MathUtils.lerp(startX, endX, rockPhase);
              rock.position.z = THREE.MathUtils.lerp(startZ, endZ, rockPhase);
              rock.position.y = THREE.MathUtils.lerp(startY, hBottom, rockPhase * rockPhase);

              rock.rotation.x += dt * (6 + bIdx * 2);
              rock.rotation.y += dt * (5 + bIdx * 3);
              rock.rotation.z += dt * (4 + bIdx);
            });
          }

          if (dumpT >= 2.4) {
            item.crusherPhase = "lower";
            if (item.oreChute) item.oreChute.visible = false;
            if (item.boulders) item.boulders.forEach((b) => (b.visible = false));
          }
        } else if (item.crusherPhase === "lower") {
          // Lowering dump bed
          const lowerT = t - 5.0;
          const p = Math.min(1.0, lowerT / 1.2);
          const ease = p * p * (3 - 2 * p);
          item.dumpAngle = (1.0 - ease) * 1.01;
          if (lowerT >= 1.2) {
            item.dumpAngle = 0;
            item.crusherPhase = "forward";
          }
        } else if (item.crusherPhase === "forward") {
          // Driving forward out of dock back onto haul road
          const fwdT = t - 6.2;
          const p = Math.min(1.0, fwdT / 1.0);
          const ease = p * p * (3 - 2 * p);
          item.dockOffset.set((1 - ease) * 2.2, 0, -(1 - ease) * 1.5);
          item.currentHeading = THREE.MathUtils.lerp(2.35, item.heading, ease);
          if (item.reverseLamps) item.reverseLamps.visible = false;
          if (fwdT >= 1.0) {
            item.crusherPhase = "none";
            item.dockOffset.set(0, 0, 0);
          }
        }

        item.mesh.position.add(item.dockOffset);
      } else {
        // 2. Normal Travel: Smooth Turning in Curves
        const delta =
          THREE.MathUtils.euclideanModulo(
            item.heading - item.currentHeading + Math.PI,
            Math.PI * 2,
          ) - Math.PI;

        if (Math.abs(delta) > 0.0002) {
          moving = true;
          // Continuous, rate-limited turning (max 2.0 rad/s)
          const maxTurnRate = 2.0;
          const desiredSpeed = Math.min(maxTurnRate, Math.abs(delta) * 5.2);
          const turnStep = Math.sign(delta) * desiredSpeed * dt;
          if (Math.abs(turnStep) >= Math.abs(delta)) {
            item.currentHeading = item.heading;
          } else {
            item.currentHeading += turnStep;
          }
        } else {
          item.currentHeading = item.heading;
        }

        // Steer front wheels smoothly into turn
        const steerTarget = Math.max(-0.55, Math.min(0.55, delta * 2.0));
        item.steerAngle = THREE.MathUtils.lerp(item.steerAngle, steerTarget, 1 - Math.exp(-dt * 12));
        if (item.frontWheelLeft) item.frontWheelLeft.rotation.y = item.steerAngle;
        if (item.frontWheelRight) item.frontWheelRight.rotation.y = item.steerAngle;
      }

      // 3. Terrain Pitch & Roll
      const curH = item.currentHeading;
      const fwdX = -Math.sin(curH);
      const fwdZ = -Math.cos(curH);
      const rgtX = Math.cos(curH);
      const rgtZ = -Math.sin(curH);

      const pX = item.mesh.position.x;
      const pZ = item.mesh.position.z;

      const hFwd = field(pX + fwdX * 1.5, -(pZ + fwdZ * 1.5)).elevation;
      const hBack = field(pX - fwdX * 1.5, -(pZ - fwdZ * 1.5)).elevation;
      const hL = field(pX - rgtX * 1.0, -(pZ - rgtZ * 1.0)).elevation;
      const hR = field(pX + rgtX * 1.0, -(pZ + rgtZ * 1.0)).elevation;

      const targetPitch = Math.atan2(hFwd - hBack, 3.0);
      const targetRoll = Math.atan2(hR - hL, 2.0) - item.steerAngle * 0.04;

      item.pitch = THREE.MathUtils.lerp(item.pitch, targetPitch, 1 - Math.exp(-dt * 12));
      item.roll = THREE.MathUtils.lerp(item.roll, targetRoll, 1 - Math.exp(-dt * 12));

      item.mesh.rotation.set(item.pitch, item.currentHeading, item.roll, "YXZ");

      // 4. Update Dump Bed & Hydraulic Rams
      if (item.dumpBedPivot) {
        item.dumpBedPivot.rotation.x = item.dumpAngle;
      }
      if (item.oreCargo) {
        if (item.oreLevel <= 0.04) {
          item.oreCargo.visible = false;
        } else {
          item.oreCargo.visible = true;
          const s = Math.max(0.001, item.oreLevel);
          item.oreCargo.scale.set(s > 0.05 ? 1 : 0.001, s, s);
          item.oreCargo.position.z = (1 - s) * 0.6;
        }
      }
      if (item.hydraulicLeft && item.hydraulicRight) {
        const angle = item.dumpAngle;
        const bedY = TRUCK_HINGE_Y + -1.25 * Math.sin(angle) + 0.2 * Math.cos(angle);
        const bedZ = TRUCK_HINGE_Z + -1.25 * Math.cos(angle) - 0.2 * Math.sin(angle);
        const stroke = Math.hypot(bedY - 0.42, bedZ - -0.15);
        const rot = Math.atan2(bedY - 0.42, -(bedZ - -0.15)) - Math.PI / 2;

        item.hydraulicLeft.scale.set(1, stroke, 1);
        item.hydraulicRight.scale.set(1, stroke, 1);
        item.hydraulicLeft.position.set(-0.28, 0.42 + (bedY - 0.42) * 0.5, -0.15 + (bedZ - -0.15) * 0.5);
        item.hydraulicRight.position.set(0.28, 0.42 + (bedY - 0.42) * 0.5, -0.15 + (bedZ - -0.15) * 0.5);
        item.hydraulicLeft.rotation.x = rot;
        item.hydraulicRight.rotation.x = rot;
      }
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
    if (moving) requestRender();
    if (frameId === null) animationLast = null;
  }
  const lost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    pause();
    container.dataset.context = "lost";
  };
  const restored = () => {
    contextLost = false;
    renderer.shadowMap.needsUpdate = true;
    container.dataset.context = "ready";
    syncVisibility();
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
      requestRender();
    },
    zoom: (factor) => {
      camera.position
        .sub(controls.target)
        .multiplyScalar(factor)
        .add(controls.target);
      controls.update();
      requestRender();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      pause();
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
      controls.removeEventListener("change", requestRender);
      controls.removeEventListener("start", stopFollowing);
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("webglcontextrestored", restored);
      labels.remove();
      trucks.forEach((item) => {
        if (item.oreChute) scene.remove(item.oreChute);
        if (item.boulders) item.boulders.forEach((b) => scene.remove(b));
      });
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
