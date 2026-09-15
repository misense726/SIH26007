import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MapFeature, HaulRouteState, HaulVehicleState } from "../types";
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
import { crusherLayout } from "./crusherLayout";

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
  focus: (target: "pit" | "truck" | "crusher" | "top") => void;
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
  haul?: HaulVehicleState | null;
  dumpAngle: number;
  oreLevel: number;
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
  renderer.toneMappingExposure = 0.95;
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
  scene.background = new THREE.Color("#c0d0d4");
  scene.fog = new THREE.Fog("#c0d0d4", 310, 780);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.2, 1400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 12;
  controls.maxDistance = 420;
  controls.target.set(8, -1, -39);
  let followingTruck = false;
  const stopFollowing = () => {
    followingTruck = false;
  };
  controls.addEventListener("start", stopFollowing);
  const fit = () => {
    followingTruck = false;
    controls.target.set(24, -4, -26);
    camera.position.set(45, 175, 88);
    controls.update();
    requestRender();
  };
  const hemi = new THREE.HemisphereLight("#dcebf4", "#78614c", 1.65);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff0d9", 2.7);
  sun.position.set(-85, 160, 65);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 145;
  sun.shadow.camera.bottom = -145;
  sun.shadow.camera.far = 450;
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
  const station = crusherLayout(features);

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
  const looseOreMaterial = new THREE.MeshStandardMaterial({ color: "#684536", roughness: 0.95 });
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
        disposeScene(item.mesh);
        scene.remove(item.mesh);
        if (item.oreChute) {
          disposeScene(item.oreChute);
          scene.remove(item.oreChute);
        }
        if (item.boulders) {
          item.boulders.forEach((b) => {
            disposeScene(b);
            scene.remove(b);
          });
        }
        item.label.remove();
        trucks.delete(id);
      }
    for (const v of frame.vehicles) {
      let item = trucks.get(v.vehicleId);
      if (!item) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `haul-truck-${v.vehicleId}`;
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
          dumpBedPivot.name = "dump-bed-pivot";
          dumpBedPivot.position.set(0, TRUCK_HINGE_Y, TRUCK_HINGE_Z);

          const dumpBedMesh = new THREE.Mesh(dumpGeom, material);
          dumpBedMesh.castShadow = true;
          dumpBedMesh.receiveShadow = true;
          dumpBedPivot.add(dumpBedMesh);

          oreCargo = new THREE.Mesh(oreGeom, oreMaterial);
          oreCargo.name = "ore-cargo";
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
            const boulder = new THREE.Mesh(rockGeom, looseOreMaterial);
            boulder.scale.setScalar(0.65);
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
          dumpAngle: 0,
          oreLevel: 0,
          oreChute,
          boulders,
        };
        trucks.set(v.vehicleId, item);
      }
      item.target.set(v.xM, (v.haul?.road_elevation_m ?? field(v.xM, v.yM).elevation) + 0.06, -v.yM);
      item.haul = v.haul;
      item.dumpAngle = THREE.MathUtils.degToRad(v.haul?.bed_angle_deg ?? 0);
      item.oreLevel = v.haul?.payload_fraction ?? 0;
      if (item.reverseLamps)
        item.reverseLamps.visible =
          v.haul?.phase === "REVERSING" || v.haul?.phase === "EXITING";
      item.heading = (-v.headingDeg * Math.PI) / 180;
      item.speed = v.speedMps;
      item.label.dataset.selected = String(frame.selected === v.vehicleId);

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
      if (distance > 0.001) moving = true;
      if (distance > 6 || distance <= 0.001) item.mesh.position.copy(item.target);
      else item.mesh.position.lerp(item.target, 1 - Math.exp(-dt * 18));

      {
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

      // Road grade controls the chassis. Adjacent cliff faces never tilt a truck.
      const targetPitch = THREE.MathUtils.degToRad(item.haul?.road_pitch_deg ?? 0);
      item.pitch = THREE.MathUtils.lerp(item.pitch, targetPitch, 1 - Math.exp(-dt * 12));
      item.roll = 0;

      item.mesh.rotation.set(item.pitch, item.currentHeading, item.roll, "YXZ");

      const pouring = item.haul?.phase === "DUMPING" && item.oreLevel > 0.01 && item.dumpAngle > 0.8;
      if (item.oreChute) item.oreChute.visible = false;
      if (item.boulders) {
        const outlet = item.mesh.localToWorld(new THREE.Vector3(0, 1.6, 1.7));
        item.boulders.forEach((rock, index) => {
          rock.visible = pouring;
          if (!pouring) return;
          const progress = ((item.haul?.phase_progress ?? 0) * 8 + index * 0.13) % 1;
          rock.position.copy(outlet);
          rock.position.x = THREE.MathUtils.lerp(outlet.x,
            station.x + 2.6 + ((index % 3) - 1) * 0.15, progress);
          rock.position.z = THREE.MathUtils.lerp(outlet.z, -station.y + ((index % 3) - 1) * 0.16, progress);
          rock.position.y -= progress * progress * 3.4;
          rock.rotation.set(progress * 7, index + progress * 5, progress * 4);
        });
      }

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
          item.oreCargo.scale.set(1, s, 1);
          item.oreCargo.position.z = 0;
        }
      }
      if (item.hydraulicLeft && item.hydraulicRight) {
        const angle = item.dumpAngle;
        const bedY = TRUCK_HINGE_Y + 1.25 * Math.sin(angle) + 0.2 * Math.cos(angle);
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
      if (target === "top") {
        followingTruck = false;
        controls.target.set(16, -6, -28);
        camera.position.set(16, 220, 52);
        controls.update();
        requestRender();
        return;
      }
      followingTruck = target === "truck";
      const point =
        target === "truck" ? current.vehicles.find((v) => v.isPrimary) : null;
      const crusher = features.find((f) => f.feature_type === "DESTINATION")
        ?.points[0];
      const pitPoint = features.find(
        (f) =>
          f.properties?.cartography === "pit-floor" ||
          f.properties?.cartography === "pit-loading",
      )?.points[0];
      const pitX = pitPoint?.x_m ?? -31.8;
      const pitY = pitPoint?.y_m ?? 10.5;
      const x =
        point?.xM ?? (target === "crusher" ? (crusher?.x_m ?? 32) + 4 : pitX);
      const y =
        point?.yM ?? (target === "crusher" ? (crusher?.y_m ?? 44) + 1 : pitY);
      const h = field(x, y).elevation,
        d = target === "truck" ? 11 : target === "crusher" ? 24 : 55;
      controls.target.set(x, h, -y);
      const atCrusher = target === "crusher" || Boolean(point &&
        Math.hypot(point.xM - crusherX, point.yM - crusherY) < 12);
      if (atCrusher) {
        controls.target.set(station.x + 1, station.elevation + 1.3, -station.y);
        camera.position.set(station.x - d, station.elevation + (target === "truck" ? 3 : 10),
          -station.y + (target === "truck" ? 1.2 : d * 0.65));
      } else {
        camera.position.set(x + d * 0.7, h + d, -y + d * 0.65);
      }
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
