import { defineConfig } from "vite";

// Use relative asset URLs so the build works under any GitHub Pages path
// (e.g. https://<user>.github.io/Hexfall/) and inside the Capacitor iOS web
// view (file:// origin) without needing to hardcode the repo name.
export default defineConfig({
  base: "./",
});
