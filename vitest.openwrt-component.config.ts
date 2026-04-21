import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: {
    __OPENWRT_LUCI_APP_VERSION__: JSON.stringify("test"),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/openwrt/component/**/*.test.ts?(x)"],
    setupFiles: ["./tests/setupGlobals.ts", "./tests/openwrt/component/setup.ts"],
    globals: true,
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
