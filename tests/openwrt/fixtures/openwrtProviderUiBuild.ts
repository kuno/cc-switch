import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BuiltOpenWrtProviderUi {
  outputDir: string;
  bundlePath: string;
  stylesheetPath: string;
  bundleSource: string;
  stylesheetSource: string;
}

export function buildOpenWrtProviderUiBundle({
  repoRoot = process.cwd(),
  outputDir = mkdtempSync(
    path.join(os.tmpdir(), "ccswitch-openwrt-provider-ui-"),
  ),
}: {
  repoRoot?: string;
  outputDir?: string;
} = {}): BuiltOpenWrtProviderUi {
  execFileSync("pnpm", ["exec", "vite", "build", "--outDir", outputDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CCSWITCH_BUILD_TARGET: "openwrt-provider-ui",
    },
    stdio: "pipe",
  });

  const bundlePath = path.join(outputDir, "ccswitch-provider-ui.js");
  const stylesheetPath = path.join(outputDir, "ccswitch-provider-ui.css");

  return {
    outputDir,
    bundlePath,
    stylesheetPath,
    bundleSource: readFileSync(bundlePath, "utf8"),
    stylesheetSource: readFileSync(stylesheetPath, "utf8"),
  };
}
