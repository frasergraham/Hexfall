import { defineConfig } from "vite";

// Default config targets GitHub Pages served from the apex of
// hexrain.xyz (a CNAME-bound custom domain), so the site lives at the
// root and assets resolve under "/". The iOS / Capacitor build
// overrides `base` to "./" and `outDir` to "dist" via CLI flags in the
// npm `build:ios` script — relative URLs are required inside the iOS
// web view, where the bundle is served from a non-root origin.
export default defineConfig({
  base: "/",
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "100.86.120.53",
      "frasers-macbook-air.taile0f0ae.ts.net",
    ],
  },
});
