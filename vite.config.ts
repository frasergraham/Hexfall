import { defineConfig } from "vite";

// Absolute base matching the GitHub Pages sub-path so asset URLs resolve
// correctly no matter how the page is navigated to.
export default defineConfig({
  base: "/Hexfall/",
  build: {
    // Output the build into /docs so GitHub Pages can serve it directly when
    // configured as Source: "Deploy from a branch", folder "/docs".
    outDir: "docs",
    emptyOutDir: true,
  },
});
