import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createMineRenderer, type MineRenderer } from "./mineRenderer";
import { defaultWorldState } from "../state/defaultState";
import { createSupervisorViewModel } from "../supervisor/supervisorViewModel";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  controls: null as unknown as {
    emit: (type: string) => void;
    damping: number;
    target: THREE.Vector3;
  },
}));

class ElementStub extends EventTarget {
  dataset: Record<string, string> = {};
  style = {};
  clientWidth = 800;
  clientHeight = 600;
  children: ElementStub[] = [];
  setAttribute() {}
  appendChild(child: ElementStub) { this.children.push(child); }
  remove() {}
}

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = new ElementStub();
      shadowMap = {};
      info = { render: { calls: 1, triangles: 1 }, memory: { geometries: 1, textures: 0 } };
      setPixelRatio() {}
      setSize() {}
      render = mocks.render;
      dispose = mocks.dispose;
      forceContextLoss() {}
    },
  };
});
vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const { Vector3 } = await import("three");
  return {
    OrbitControls: class {
      target = new Vector3();
      damping = 0;
      listeners = new Map<string, Set<() => void>>();
      constructor() { mocks.controls = this; }
      addEventListener(type: string, callback: () => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(callback);
      }
      removeEventListener(type: string, callback: () => void) {
        this.listeners.get(type)?.delete(callback);
      }
      emit(type: string) { this.listeners.get(type)?.forEach((callback) => callback()); }
      update() {
        if (this.damping > 0) {
          this.damping--;
          this.emit("change");
          return true;
        }
        return false;
      }
      dispose() {}
    },
  };
});
vi.mock("./mineSceneGeometry", async () => {
  const { Group, BoxGeometry } = await import("three");
  return {
    buildTerrain: () => ({ mesh: new Group(), field: () => ({ elevation: 0 }) }),
    buildVegetation: () => new Group(),
    truckGeometry: () => new BoxGeometry(),
    dumpBedGeometry: () => new BoxGeometry(),
    frontWheelGeometry: () => new BoxGeometry(),
    oreCargoGeometry: () => new BoxGeometry(),
    oreChuteGeometry: () => new BoxGeometry(),
    oreRockGeometry: () => new BoxGeometry(),
    TRUCK_HINGE_Y: 0.675,
    TRUCK_HINGE_Z: 1.41,
    disposeScene: vi.fn(),
  };
});
vi.mock("./mineInfrastructure", async () => {
  const { Group } = await import("three");
  return { buildInfrastructure: () => new Group() };
});

let pending: Map<number, FrameRequestCallback>;
let nextId: number;
let now: number;
let documentStub: EventTarget & { hidden: boolean; createElement: () => ElementStub };
let intersect: (entries: { isIntersecting: boolean }[]) => void;
let resize: () => void;
let container: ElementStub;
let mine: MineRenderer;
function step(ms = 34) {
  now += ms;
  const callbacks = [...pending.values()];
  pending.clear();
  callbacks.forEach((callback) => callback(now));
}
function settle() {
  for (let i = 0; pending.size && i < 200; i++) step();
  expect(pending.size).toBe(0);
}
function visibility(hidden: boolean) {
  documentStub.hidden = hidden;
  documentStub.dispatchEvent(new Event("visibilitychange"));
}
const vehicle = () => ({
  ...createSupervisorViewModel(defaultWorldState).vehicles[0],
  vehicleId: "TRUCK", isPrimary: true, xM: 0, yM: 0, headingDeg: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  pending = new Map();
  nextId = 0;
  now = 100;
  documentStub = Object.assign(new EventTarget(), {
    hidden: false, createElement: () => new ElementStub(),
  });
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => pending.delete(id)));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect() {}
  });
  container = new ElementStub();
  mine = createMineRenderer(container as unknown as HTMLElement, [], vi.fn());
});
afterEach(() => {
  mine.dispose();
  vi.unstubAllGlobals();
});

describe("mine renderer scheduling", () => {
  it("waits for intersection and cancels even RAF id zero while hidden or offscreen", () => {
    expect(pending.size).toBe(0);
    intersect([{ isIntersecting: true }]);
    expect(pending.size).toBe(1);
    visibility(true);
    expect(pending.size).toBe(0);
    mine.update({ vehicles: [vehicle()] });
    resize();
    mocks.controls.emit("change");
    expect(pending.size).toBe(0);
    intersect([{ isIntersecting: false }]);
    visibility(false);
    expect(pending.size).toBe(0);
    intersect([{ isIntersecting: true }]);
    visibility(false);
    expect(pending.size).toBe(1);
    step();
    expect(mocks.render).toHaveBeenCalledTimes(1);
    intersect([{ isIntersecting: false }]);
    expect(pending.size).toBe(0);
  });

  it("settles stationary poses and damping, then wakes on updates, resize and interaction", () => {
    mine.update({ vehicles: [vehicle()] });
    intersect([{ isIntersecting: true }]);
    settle();
    const draws = mocks.render.mock.calls.length;
    step(5000);
    expect(mocks.render).toHaveBeenCalledTimes(draws);
    mine.update({ vehicles: [vehicle()], selected: "TRUCK" });
    expect(pending.size).toBe(1);
    settle();
    resize();
    expect(pending.size).toBe(1);
    settle();
    mocks.controls.damping = 4;
    mocks.controls.emit("change");
    const beforeDamping = mocks.render.mock.calls.length;
    settle();
    expect(mocks.render.mock.calls.length - beforeDamping).toBe(5);
  });

  it("wakes for camera commands and settles follow at the final truck pose", () => {
    mine.update({ vehicles: [vehicle()] });
    intersect([{ isIntersecting: true }]);
    settle();
    mine.fit();
    expect(pending.size).toBe(1);
    settle();
    mine.zoom(0.8);
    expect(pending.size).toBe(1);
    settle();
    mine.focus("truck");
    expect(pending.size).toBe(1);
    mine.update({ vehicles: [{ ...vehicle(), xM: 3, headingDeg: 90 }] });
    settle();
    expect(mocks.controls.target.x).toBe(3);
    mocks.controls.emit("start");
    mine.update({ vehicles: [{ ...vehicle(), xM: 4 }] });
    settle();
    expect(mocks.controls.target.x).toBe(3);
  });

  it("retains the 30 FPS limit across repeated state updates", () => {
    intersect([{ isIntersecting: true }]);
    step();
    mine.update({ vehicles: [] });
    step(10);
    step(10);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    step(14);
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it("resumes interpolation with a normal step instead of hidden elapsed time", () => {
    mine.update({ vehicles: [vehicle()] });
    intersect([{ isIntersecting: true }]);
    settle();
    const scene = mocks.render.mock.calls.at(-1)![0] as THREE.Scene;
    const truck = scene.children.find((item) => item instanceof THREE.Mesh && item.geometry instanceof THREE.BoxGeometry)!;
    visibility(true);
    mine.update({ vehicles: [{ ...vehicle(), xM: 3 }] });
    step(60_000);
    visibility(false);
    step();
    expect(truck.position.x).toBeCloseTo(3 * (1 - Math.exp(-18 / 30)), 6);
    settle();
    expect(truck.position.x).toBe(3);
  });

  it("pauses context loss and restores only when also visible", () => {
    intersect([{ isIntersecting: true }]);
    const canvas = container.children[0];
    const event = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(pending.size).toBe(0);
    mine.update({ vehicles: [] });
    expect(pending.size).toBe(0);
    visibility(true);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(pending.size).toBe(0);
    visibility(false);
    expect(pending.size).toBe(1);
    settle();
    expect(container.dataset.context).toBe("ready");
  });

  it("disposal cancels work and leaves no event path that restarts it", () => {
    intersect([{ isIntersecting: true }]);
    mine.dispose();
    expect(pending.size).toBe(0);
    visibility(false);
    intersect([{ isIntersecting: true }]);
    resize();
    mocks.controls.emit("change");
    container.children[0].dispatchEvent(new Event("webglcontextrestored"));
    mine.update({ vehicles: [vehicle()] });
    expect(pending.size).toBe(0);
    mine.dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});
