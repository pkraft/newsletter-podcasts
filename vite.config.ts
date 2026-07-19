import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Admin SPA, served from GitHub Pages at /admin/. Built AFTER the site build
// (`npm run build && npm run build:admin`) because src/build.ts wipes _site/.
export default defineConfig({
  root: "admin",
  base: "/admin/",
  plugins: [react()],
  build: {
    outDir: "../_site/admin",
    emptyOutDir: true,
  },
});
