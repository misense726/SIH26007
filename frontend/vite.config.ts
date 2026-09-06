import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "FOGSEN_");
  const apiTarget = env.FOGSEN_API_TARGET || "http://127.0.0.1:8000";
  const websocketTarget = env.FOGSEN_WS_TARGET || apiTarget.replace(/^http/, "ws");
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const port = Number(processEnv?.PORT || 5173);

  return {
    plugins: [react()],
    build: {
      sourcemap: false,
    },
    server: {
      port,
      strictPort: true,
      proxy: {
        "/api": apiTarget,
        "/ws": {
          target: websocketTarget,
          ws: true,
        },
      },
    },
  };
});
