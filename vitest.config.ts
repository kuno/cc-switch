import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/cypress/**",
  "**/.{idea,git,cache,output,temp}/**",
  "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
];

const OPENWRT_TEST_GLOB = "tests/openwrt/**";
const hasExplicitOpenWrtTarget = process.argv.some((arg) =>
  arg.includes("tests/openwrt/"),
);
const setupFiles = hasExplicitOpenWrtTarget
  ? [
      "./tests/setupGlobals.ts",
      "./tests/setupTests.ts",
      "./tests/openwrt/component/setup.ts",
    ]
  : ["./tests/setupGlobals.ts", "./tests/setupTests.ts"];

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
    setupFiles,
    globals: true,
    exclude: hasExplicitOpenWrtTarget
      ? DEFAULT_EXCLUDES
      : [...DEFAULT_EXCLUDES, OPENWRT_TEST_GLOB],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
