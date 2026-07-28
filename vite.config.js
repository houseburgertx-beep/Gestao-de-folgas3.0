import { defineConfig } from "vite";

export default defineConfig({
  // Caminhos relativos permitem publicar em qualquer nome de repositório.
  base: "./",
  build: {
    target: "es2020",
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
