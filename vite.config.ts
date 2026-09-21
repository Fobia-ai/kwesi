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
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Framework core
          react: ["react", "react-dom", "react-router-dom"],
          // Audio/MIDI libraries
          audio: ["tone", "@tonejs/midi"],
          // Music notation rendering
          notation: ["abcjs"],
          // Markdown rendering
          markdown: ["react-markdown", "remark-gfm", "remark-breaks"],
          // Database + utilities
          data: ["better-sqlite3", "dotenv", "undici"],
        },
      },
    },
  },
});
