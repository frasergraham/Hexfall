import { defineConfig } from "vite";

// Default config targets GitHub Pages (absolute /HexRain/ base, output to
// /docs). The iOS / Capacitor build overrides `base` to "./" and `outDir` to
// "dist" via CLI flags in the npm `build:ios` script — relative URLs are
// required inside the iOS web view, where the bundle is served from a
// non-`/HexRain/` origin.
export default defineConfig({
  base: "/HexRain/",
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
