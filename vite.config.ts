import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // better-sqlite3 is native code and must not run in worker threads.
    pool: "forks",
    fileParallelism: false,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
});
