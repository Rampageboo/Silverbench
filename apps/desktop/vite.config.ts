import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: ["..", "../..", "../../.."]
    },
    watch: {
      // Network/mapped drives (e.g. Z:) often break native fs watchers on Windows.
      usePolling: true,
      interval: 1000,
      ignored: ["**/src-tauri/target/**"]
    }
  },
  clearScreen: false
});
