import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";

const openWrtProviderUiEntry = path.resolve(
  __dirname,
  "src/openwrt-provider-ui/index.ts",
);
const openWrtProviderUiOutDir = path.resolve(
  __dirname,
  "openwrt/provider-ui-dist",
);
const openWrtIslandDaemonCardEntry = path.resolve(
  __dirname,
  "src/openwrt-islands/daemon-card/entry.tsx",
);
const openWrtIslandDaemonCardOutDir = path.resolve(
  __dirname,
  "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/ccswitch/islands",
);
const openWrtVisualHarnessRoot = path.resolve(
  __dirname,
  "tests/openwrt/visual/harness",
);
const openWrtVisualHarnessOutDir = path.resolve(
  __dirname,
  "tests/openwrt/visual/harness-dist",
);

export default defineConfig(({ command }) => {
  const buildTarget = process.env.CCSWITCH_BUILD_TARGET;
  const isOpenWrtProviderUiBuild = buildTarget === "openwrt-provider-ui";
  const isOpenWrtVisualHarnessBuild =
    buildTarget === "openwrt-visual-harness";
  const isOpenWrtIslandDaemonCardBuild =
    buildTarget === "openwrt-island-daemon-card";
  const define =
    isOpenWrtProviderUiBuild || isOpenWrtIslandDaemonCardBuild
      ? {
          "process.env.NODE_ENV": JSON.stringify("production"),
        }
      : undefined;

  return {
    root: isOpenWrtProviderUiBuild || isOpenWrtIslandDaemonCardBuild
      ? "."
      : isOpenWrtVisualHarnessBuild
        ? openWrtVisualHarnessRoot
        : "src",
    plugins: [
      !isOpenWrtProviderUiBuild &&
        !isOpenWrtVisualHarnessBuild &&
        !isOpenWrtIslandDaemonCardBuild &&
        command === "serve" &&
        codeInspectorPlugin({
          bundler: "vite",
        }),
      react(),
    ].filter(Boolean),
    base: "./",
    build: isOpenWrtProviderUiBuild
      ? {
          outDir: openWrtProviderUiOutDir,
          emptyOutDir: true,
          cssCodeSplit: false,
          lib: {
            entry: openWrtProviderUiEntry,
            formats: ["iife"],
            name: "CCSwitchOpenWrtProviderUi",
            fileName: () => "ccswitch-provider-ui.js",
            cssFileName: "ccswitch-provider-ui",
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        }
      : isOpenWrtIslandDaemonCardBuild
        ? {
            outDir: openWrtIslandDaemonCardOutDir,
            emptyOutDir: false,
            cssCodeSplit: false,
            lib: {
              entry: openWrtIslandDaemonCardEntry,
              formats: ["iife"],
              name: "CCSwitchOpenWrtDaemonCardIsland",
              fileName: () => "daemon-card.js",
              cssFileName: "daemon-card",
            },
            rollupOptions: {
              output: {
                inlineDynamicImports: true,
              },
            },
          }
      : isOpenWrtVisualHarnessBuild
        ? {
            outDir: openWrtVisualHarnessOutDir,
            emptyOutDir: true,
          }
      : {
          outDir: "../dist",
          emptyOutDir: true,
        },
    server: {
      port: 3000,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define,
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
  };
});
