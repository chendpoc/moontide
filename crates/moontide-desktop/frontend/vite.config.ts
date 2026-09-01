import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: [
      { find: "$lib/utils.js", replacement: path.resolve("./src/lib/utils/index.ts") },
      { find: "$lib", replacement: path.resolve("./src/lib") },
    ],
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
  },
});
