import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
