import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
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
const extractedIconDir = path.resolve(__dirname, "src/icons/extracted");
const openWrtProviderUiIconDir = path.resolve(
  __dirname,
  "src/openwrt-provider-ui/icons",
);
const openWrtProviderUiIconBaseUrl =
  "/luci-static/resources/ccswitch/provider-ui/icons";
const openWrtVisualHarnessRoot = path.resolve(
  __dirname,
  "tests/openwrt/visual/harness",
);
const openWrtVisualHarnessOutDir = path.resolve(
  __dirname,
  "tests/openwrt/visual/harness-dist",
);

function resolveOpenWrtLuciAppVersion(): string {
  const override = process.env.OPENWRT_LUCI_APP_VERSION?.trim();
  if (override) {
    return override;
  }

  try {
    return execSync("git describe --tags --always --long --dirty", {
      encoding: "utf8",
    }).trim();
  } catch {
    return process.env.npm_package_version?.trim() || "unknown";
  }
}

export default defineConfig(({ command }) => {
  const buildTarget = process.env.CCSWITCH_BUILD_TARGET;
  const isOpenWrtProviderUiBuild = buildTarget === "openwrt-provider-ui";
  const isOpenWrtVisualHarnessBuild = buildTarget === "openwrt-visual-harness";
  const define = {
    __OPENWRT_LUCI_APP_VERSION__: JSON.stringify(
      resolveOpenWrtLuciAppVersion(),
    ),
    __OPENWRT_PROVIDER_UI_ICON_BASE_URL__: JSON.stringify(
      isOpenWrtVisualHarnessBuild ? "./icons" : openWrtProviderUiIconBaseUrl,
    ),
    ...(isOpenWrtProviderUiBuild
      ? {
          "process.env.NODE_ENV": JSON.stringify("production"),
          "process.env.CCSWITCH_USE_SHADOW_DOM": JSON.stringify(
            process.env.CCSWITCH_USE_SHADOW_DOM ?? "",
          ),
        }
      : {}),
  };

  return {
    root: isOpenWrtProviderUiBuild
      ? "."
      : isOpenWrtVisualHarnessBuild
        ? openWrtVisualHarnessRoot
        : "src",
    plugins: [
      (isOpenWrtProviderUiBuild || isOpenWrtVisualHarnessBuild) && {
        name: "emit-openwrt-provider-icons",
        generateBundle() {
          const emittedByImports = new Set([
            "dds.svg",
            "eflowcode.png",
            "pipellm.png",
            "shengsuanyun.svg",
          ]);
          const emittedIconFiles = new Set(emittedByImports);

          for (const iconFile of fs.readdirSync(extractedIconDir)) {
            if (!/\.(svg|png)$/i.test(iconFile)) {
              continue;
            }

            if (emittedByImports.has(iconFile)) {
              continue;
            }

            this.emitFile({
              type: "asset",
              fileName: `icons/${iconFile}`,
              source: fs.readFileSync(path.join(extractedIconDir, iconFile)),
            });
            emittedIconFiles.add(iconFile);
          }

          if (!fs.existsSync(openWrtProviderUiIconDir)) {
            return;
          }

          for (const iconFile of fs.readdirSync(openWrtProviderUiIconDir)) {
            if (!/\.(svg|png)$/i.test(iconFile)) {
              continue;
            }

            if (emittedIconFiles.has(iconFile)) {
              continue;
            }

            this.emitFile({
              type: "asset",
              fileName: `icons/${iconFile}`,
              source: fs.readFileSync(
                path.join(openWrtProviderUiIconDir, iconFile),
              ),
            });
            emittedIconFiles.add(iconFile);
          }
        },
      },
      !isOpenWrtProviderUiBuild &&
        !isOpenWrtVisualHarnessBuild &&
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
            cssFileName: "openwrt-luci-host",
          },
          rollupOptions: {
            output: {
              assetFileNames: (assetInfo) => {
                const assetName = assetInfo.name ?? "";

                if (/\.css$/i.test(assetName)) {
                  return "openwrt-luci-host.css";
                }

                if (/\.(svg|png)$/i.test(assetName)) {
                  return "icons/[name][extname]";
                }

                return "assets/[name]-[hash][extname]";
              },
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
