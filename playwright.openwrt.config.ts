import { defineConfig } from "@playwright/test";

const VISUAL_HARNESS_PORT = 4174;

export default defineConfig({
  testDir: "./tests/openwrt/visual",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: "playwright-report/openwrt-visual",
      },
    ],
    [
      "junit",
      {
        outputFile: "test-results/openwrt-visual/junit.xml",
      },
    ],
  ],
  outputDir: "test-results/openwrt-visual/artifacts",
  use: {
    baseURL: `http://127.0.0.1:${VISUAL_HARNESS_PORT}`,
    viewport: {
      width: 1280,
      height: 800,
    },
  },
  expect: {
    // 1% pixel variance keeps small anti-aliasing drift from flaking snapshots
    // while still failing obvious UI regressions.
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
      pathTemplate:
        "{testDir}/__snapshots__{/projectName}/{testFilePath}/{arg}{ext}",
    },
  },
  projects: [
    {
      name: "openwrt-light",
      use: {
        browserName: "chromium",
      },
    },
    {
      name: "openwrt-dark",
      use: {
        browserName: "chromium",
      },
    },
  ],
  webServer: {
    command:
      "corepack pnpm build:openwrt-visual-harness && corepack pnpm preview:openwrt-visual-harness",
    port: VISUAL_HARNESS_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
