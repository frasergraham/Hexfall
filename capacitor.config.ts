import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hexrain.app",
  appName: "Hex Rain",
  webDir: "dist",
  ios: {
    contentInset: "always",
    backgroundColor: "#0d0f1c",
  },
};

export default config;
