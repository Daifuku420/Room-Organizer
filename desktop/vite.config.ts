import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Cargo writes thousands of files here during a build. Watching them
      // locks binaries mid-write on Windows and kills the dev server.
      ignored: ["**/src-tauri/**"],
    },
  },
});
