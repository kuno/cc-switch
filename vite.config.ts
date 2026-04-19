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

export default defineConfig(({ command }) => {
  const buildTarget = process.env.CCSWITCH_BUILD_TARGET;
  const isOpenWrtProviderUiBuild = buildTarget === "openwrt-provider-ui";
  const define = isOpenWrtProviderUiBuild
    ? {
        "process.env.NODE_ENV": JSON.stringify("production"),
      }
    : undefined;

  return {
    root: isOpenWrtProviderUiBuild ? "." : "src",
    plugins: [
      !isOpenWrtProviderUiBuild &&
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
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
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
