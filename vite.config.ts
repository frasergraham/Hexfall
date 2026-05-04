import { defineConfig } from "vite";

// Default config targets the Railway deploy (static-served from dist/
// at the apex of hexrain.xyz), so the site lives at the root and assets
// resolve under "/". The iOS / Capacitor build overrides `base` to "./"
// via the npm `build:ios` script — relative URLs are required inside
// the iOS web view, where the bundle is served from a non-root origin.
export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
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
