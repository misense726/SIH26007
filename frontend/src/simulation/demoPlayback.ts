import type { WorldState } from "../types";
import { isWorldStateSnapshot } from "../state/worldStateSnapshot";
import type { ConnectionState } from "../state/useTelemetry";

export interface DemoManifest {
  version: 1;
  frame_interval_ms: number;
  reference_map: WorldState["reference_map"];
  chunks: { url: string; frames: number }[];
}

type FramePatch = Partial<WorldState>;

export function readDemoManifest(value: unknown): DemoManifest {
  const manifest = value as DemoManifest | null;
  if (manifest?.version !== 1 || !Number.isFinite(manifest.frame_interval_ms)
    || manifest.frame_interval_ms < 50 || manifest.frame_interval_ms > 2000
    || !manifest.reference_map || !Array.isArray(manifest.chunks) || !manifest.chunks.length
    || !manifest.chunks.every((chunk) => chunk && typeof chunk.url === "string" && /^\/demo\/[a-zA-Z0-9._-]+\.json\.gz$/.test(chunk.url)
      && Number.isInteger(chunk.frames) && chunk.frames > 0 && chunk.frames <= 100)) {
    throw new Error("Invalid demo manifest");
  }
  return manifest;
}

export function decodeDemoFrames(value: unknown, manifest: DemoManifest, count: number): WorldState[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error("Invalid demo chunk");
  let previous: Partial<WorldState> = {};
  return value.map((patch: FramePatch) => {
    const frame = { ...previous, ...patch, reference_map: manifest.reference_map };
    if (!isWorldStateSnapshot(frame) || frame.mode !== "SIMULATED") {
      throw new Error("Invalid simulated frame");
    }
    previous = frame;
    return frame;
  });
}

async function fetchChecked(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Demo download failed: ${response.status}`);
  return response;
}

export function createChunkLoader() {
  const cache = new Map<string, ArrayBuffer>();
  let bytes = 0;
  const maxBytes = 20 * 1024 * 1024;
  return async (url: string, signal: AbortSignal): Promise<unknown> => {
    let compressed = cache.get(url);
    if (!compressed) {
      compressed = await (await fetchChecked(url, signal)).arrayBuffer();
      const header = new Uint8Array(compressed, 0, Math.min(2, compressed.byteLength));
      // Some static hosts set Content-Encoding and the browser already decompresses the body.
      if (header[0] !== 0x1f || header[1] !== 0x8b) {
        compressed = await new Response(new Blob([compressed]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (compressed.byteLength <= maxBytes) {
        while (bytes + compressed.byteLength > maxBytes) {
          const oldest = cache.keys().next().value!;
          bytes -= cache.get(oldest)!.byteLength;
          cache.delete(oldest);
        }
        cache.set(url, compressed);
        bytes += compressed.byteLength;
      }
    } else {
      cache.delete(url);
      cache.set(url, compressed);
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    const result: unknown = await new Response(stream).json();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  };
}
interface PlaybackOptions {
  onWorld: (world: WorldState) => void;
  onConnection: (connection: ConnectionState) => void;
  loadManifest?: (signal: AbortSignal) => Promise<unknown>;
  loadChunk?: (url: string, signal: AbortSignal) => Promise<unknown>;
}

export function createDemoPlayback({
  onWorld,
  onConnection,
  loadManifest = async (signal) => (await fetchChecked("/demo/manifest.json", signal)).json(),
  loadChunk = createChunkLoader(),
}: PlaybackOptions) {
  let active = false;
  let disposed = false;
  let generation = 0;
  let manifest: DemoManifest | null = null;
  let frames: WorldState[] = [];
  let chunkIndex = 0;
  let frameIndex = 0;
  let retryMs = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;

  async function advance() {
    if (!active || disposed) return;
    const token = generation;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      if (!manifest) {
        const loaded = readDemoManifest(await loadManifest(controller.signal));
        if (token !== generation) return;
        manifest = loaded;
      }
      if (frameIndex >= frames.length) {
        const chunk = manifest.chunks[chunkIndex];
        const data = await loadChunk(chunk.url, controller.signal);
        if (token !== generation) return;
        frames = decodeDemoFrames(data, manifest, chunk.frames);
        frameIndex = 0;
        chunkIndex = (chunkIndex + 1) % manifest.chunks.length;
      }
      if (token !== generation) return;
      onWorld(frames[frameIndex++]);
      onConnection("CONNECTED");
      retryMs = 1000;
      timer = setTimeout(advance, manifest.frame_interval_ms);
    } catch {
      if (token !== generation) return;
      // Keep the last valid frame during a failed download; never reset the scene.
      onConnection("DISCONNECTED");
      timer = setTimeout(advance, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }

  function setActive(next: boolean) {
    if (disposed || active === next) return;
    active = next;
    generation++;
    clearTimeout(timer);
    request?.abort();
    if (active) void advance();
  }

  return {
    setActive,
    dispose() {
      setActive(false);
      disposed = true;
      frames = [];
    },
  };
}
