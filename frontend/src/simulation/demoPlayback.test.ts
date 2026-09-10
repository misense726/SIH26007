import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorldState } from "../state/defaultState";
import { createChunkLoader, createDemoPlayback, decodeDemoFrames, readDemoManifest, type DemoManifest } from "./demoPlayback";

const manifest: DemoManifest = {
  version: 1,
  frame_interval_ms: 100,
  reference_map: {
    map_id: "haul", name: "Mine", version: 1, created_at_ms: 0,
    coordinate_frame: "LOCAL_CARTESIAN_METRES", source: "MANUAL", features: [],
  },
  chunks: [{ url: "/demo/first.json.gz", frames: 2 }, { url: "/demo/second.json.gz", frames: 1 }],
};
const firstChunk = [{ ...defaultWorldState, sequence: 1 }, { sequence: 2 }];

function setup(loadChunk = vi.fn(async (url: string) => url.includes("first") ? firstChunk : [{ ...defaultWorldState, sequence: 3 }])) {
  const onWorld = vi.fn();
  const onConnection = vi.fn();
  const loadManifest = vi.fn(async () => manifest);
  const player = createDemoPlayback({ onWorld, onConnection, loadManifest, loadChunk });
  return { player, onWorld, onConnection, loadManifest, loadChunk };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("static simulation playback", () => {
  it("validates the manifest and rejects remote chunks or unbounded frame counts", () => {
    expect(readDemoManifest(manifest)).toBe(manifest);
    expect(() => readDemoManifest({ ...manifest, frame_interval_ms: 0 })).toThrow();
    expect(() => readDemoManifest({ ...manifest, chunks: [{ url: "https://example.com/a.json.gz", frames: 2 }] })).toThrow();
    expect(() => readDemoManifest({ ...manifest, chunks: [{ url: "/demo/a.json.gz", frames: 10000 }] })).toThrow();
  });

  it("merges top-level deltas without mutating earlier frames or duplicating the map", () => {
    const frames = decodeDemoFrames(firstChunk, manifest, 2);
    expect(frames.map((frame) => frame.sequence)).toEqual([1, 2]);
    expect(frames[0].reference_map).toBe(manifest.reference_map);
    expect(frames[1].reference_map).toBe(frames[0].reference_map);
    expect(frames[1].vehicles).toBe(frames[0].vehicles);
    expect(() => decodeDemoFrames([{ sequence: 1 }], manifest, 1)).toThrow();
    expect(() => decodeDemoFrames([{ ...defaultWorldState, mode: "LIVE" }], manifest, 1)).toThrow();
    expect(() => decodeDemoFrames(firstChunk, manifest, 3)).toThrow();
  });

  it("does no loading before visible playback starts and loads chunks only as needed", async () => {
    const { player, loadManifest, loadChunk, onWorld } = setup();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadManifest).not.toHaveBeenCalled();
    player.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onWorld.mock.calls.map(([frame]) => frame.sequence)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(onWorld.mock.calls.map(([frame]) => frame.sequence)).toEqual([1, 2]);
    expect(loadChunk).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(onWorld.mock.calls.map(([frame]) => frame.sequence)).toEqual([1, 2, 3]);
    await vi.advanceTimersByTimeAsync(100);
    expect(onWorld.mock.calls.map(([frame]) => frame.sequence)).toEqual([1, 2, 3, 1]);
    player.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("freezes hidden/manual-paused playback and resumes without catching up", async () => {
    const { player, onWorld, loadChunk } = setup();
    player.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    player.setActive(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(onWorld).toHaveBeenCalledTimes(1);
    expect(loadChunk).toHaveBeenCalledTimes(1);
    player.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onWorld.mock.calls.map(([frame]) => frame.sequence)).toEqual([1, 2]);
    player.dispose();
  });

  it("aborts an in-flight download on hide and ignores its late response", async () => {
    let resolve!: (value: typeof firstChunk) => void;
    let signal!: AbortSignal;
    const loadChunk = vi.fn((_url: string, incoming: AbortSignal) => {
      signal = incoming;
      return new Promise<typeof firstChunk>((done) => { resolve = done; });
    });
    const onWorld = vi.fn();
    const player = createDemoPlayback({ onWorld, onConnection: vi.fn(), loadManifest: async () => manifest, loadChunk });
    player.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    player.setActive(false);
    expect(signal.aborted).toBe(true);
    resolve(firstChunk);
    await vi.advanceTimersByTimeAsync(0);
    expect(onWorld).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    player.dispose();
  });

  it("backs off after failures and clears retry work when paused", async () => {
    const loadChunk = vi.fn(async () => { throw new Error("offline"); });
    const { player, onConnection } = setup(loadChunk);
    player.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onConnection).toHaveBeenLastCalledWith("DISCONNECTED");
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadChunk).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(loadChunk).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadChunk).toHaveBeenCalledTimes(3);
    player.setActive(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(loadChunk).toHaveBeenCalledTimes(3);
    player.dispose();
  });

  it("does not skip a chunk when a download fails", async () => {
    const loadChunk = vi.fn(async (_url: string) => firstChunk).mockRejectedValueOnce(new Error("offline"));
    const { player, onWorld } = setup(loadChunk);
    player.setActive(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadChunk.mock.calls.map(([url]) => url)).toEqual(["/demo/first.json.gz", "/demo/first.json.gz"]);
    expect(onWorld.mock.calls[0][0].sequence).toBe(1);
    player.dispose();
  });
});

it("accepts bodies already decompressed by the browser and caches them compactly", async () => {
  const request = vi.fn(async () => new Response(JSON.stringify(firstChunk), { headers: { "Content-Encoding": "gzip" } }));
  vi.stubGlobal("fetch", request);
  const load = createChunkLoader();
  const signal = new AbortController().signal;
  expect(await load("/demo/first.json.gz", signal)).toEqual(firstChunk);
  expect(await load("/demo/first.json.gz", signal)).toEqual(firstChunk);
  expect(request).toHaveBeenCalledTimes(1);
});
it("reuses compressed downloads when a recording loops", async () => {
  const compressed = await new Response(new Blob([JSON.stringify(firstChunk)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const request = vi.fn(async () => new Response(compressed));
  vi.stubGlobal("fetch", request);
  const load = createChunkLoader();
  const signal = new AbortController().signal;
  expect(await load("/demo/first.json.gz", signal)).toEqual(firstChunk);
  expect(await load("/demo/first.json.gz", signal)).toEqual(firstChunk);
  expect(request).toHaveBeenCalledTimes(1);
});
