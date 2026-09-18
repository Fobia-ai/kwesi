import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5183,
    strictPort: true,
    watch: {
      // Real per-model Python venvs live here (see electron/models/envInstaller.ts) --
      // each has tens of thousands of files, which blows past Linux's inotify watch
      // limit (ENOSPC) if Vite tries to watch them. None of this is renderer source.
      ignored: ["**/venvs/**"],
    },
  },
  build: {
    outDir: "dist",
  },
});
