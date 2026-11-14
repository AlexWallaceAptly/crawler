import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves from /<repo>/; local dev and previews use /.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${process.env.PORT ?? 8787}`,
    },
  },
});
