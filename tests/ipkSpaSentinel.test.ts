import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENWRT_IPK_SPA_CSS_SENTINELS,
  OPENWRT_IPK_SPA_JS_SENTINELS,
} from "./openwrt/fixtures/ipk-spa-sentinels";
import { buildOpenWrtProviderUiBundle } from "./openwrt/fixtures/openwrtProviderUiBuild";

const repoRoot = process.cwd();
const buildIpkScriptPath = path.resolve(repoRoot, "openwrt/build-ipk.sh");
const stagedBundleOutputDir = path.resolve(repoRoot, "openwrt/provider-ui-dist");
const missingBinaryPath = path.join(
  os.tmpdir(),
  "ccswitch-missing-ipk-build-binary",
);
const luciBundleRelativePath = path.join(
  "www",
  "luci-static",
  "resources",
  "ccswitch",
  "provider-ui",
);

function expectCurrentSpaSentinels(
  bundleSource: string,
  stylesheetSource: string,
): void {
  for (const sentinel of OPENWRT_IPK_SPA_JS_SENTINELS) {
    expect(bundleSource).toContain(sentinel);
  }

  for (const sentinel of OPENWRT_IPK_SPA_CSS_SENTINELS) {
    expect(stylesheetSource).toContain(sentinel);
  }
}

function getExecFailureOutput(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const execError = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };

  return [execError.stdout, execError.stderr, execError.message]
    .map((value) =>
      typeof value === "string"
        ? value
        : Buffer.isBuffer(value)
          ? value.toString("utf8")
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

describe("OpenWrt IPK SPA safeguards", () => {
  it("builds the current OpenWrt SPA into a temp directory with the required sentinels", () => {
    const { bundleSource, stylesheetSource } = buildOpenWrtProviderUiBundle({
      repoRoot,
    });

    expectCurrentSpaSentinels(bundleSource, stylesheetSource);
  });

  it("fails loud when pnpm is unavailable for the mandatory SPA rebuild", () => {
    try {
      execFileSync(
        "/bin/bash",
        [buildIpkScriptPath, "aarch64", "--binary", missingBinaryPath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          },
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (error) {
      const output = getExecFailureOutput(error);

      expect(output).toContain(
        "pnpm is required to rebuild the OpenWrt provider UI bundle.",
      );
      expect(output).toContain("Run `pnpm install --frozen-lockfile` first");
      expect(output).not.toContain(`binary not found: ${missingBinaryPath}`);
      return;
    }

    throw new Error("build-ipk.sh unexpectedly succeeded without pnpm");
  });

  it("honors CCSWITCH_IPK_SKIP_UI_REBUILD=1 when a staged bundle is already present", () => {
    buildOpenWrtProviderUiBundle({
      repoRoot,
      outputDir: stagedBundleOutputDir,
    });

    try {
      execFileSync(
        "/bin/bash",
        [buildIpkScriptPath, "aarch64", "--binary", missingBinaryPath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CCSWITCH_IPK_SKIP_UI_REBUILD: "1",
          },
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (error) {
      const output = getExecFailureOutput(error);

      expect(output).toContain(
        "Skipping OpenWrt provider UI rebuild because CCSWITCH_IPK_SKIP_UI_REBUILD=1",
      );
      expect(output).not.toContain("Rebuilding OpenWrt provider UI bundle");
      expect(output).toContain(`binary not found: ${missingBinaryPath}`);
      return;
    }

    throw new Error("build-ipk.sh unexpectedly succeeded with a missing binary");
  });

  const slowIt =
    process.env.CCSWITCH_RUN_IPK_BUILD_TEST === "1" ? it : it.skip;

  slowIt("packages the current SPA sentinels into the luci-app IPK", () => {
    const distDir = mkdtempSync(path.join(os.tmpdir(), "ccswitch-ipk-dist-"));
    const ipkExtractDir = mkdtempSync(
      path.join(os.tmpdir(), "ccswitch-ipk-extract-"),
    );
    const dataExtractDir = mkdtempSync(
      path.join(os.tmpdir(), "ccswitch-ipk-data-"),
    );

    execFileSync(
      "/bin/bash",
      [buildIpkScriptPath, "aarch64", "--dist-dir", distDir],
      {
        cwd: repoRoot,
        env: { ...process.env },
        stdio: "pipe",
      },
    );

    const luciIpkName = readdirSync(distDir).find((entry) =>
      /^luci-app-cc-switch_.*_all\.ipk$/.test(entry),
    );
    expect(luciIpkName).toBeDefined();

    const luciIpkPath = path.join(distDir, luciIpkName!);

    execFileSync("tar", ["-xzf", luciIpkPath, "-C", ipkExtractDir], {
      stdio: "pipe",
    });
    execFileSync(
      "tar",
      ["-xzf", path.join(ipkExtractDir, "data.tar.gz"), "-C", dataExtractDir],
      {
        stdio: "pipe",
      },
    );

    const bundleSource = readFileSync(
      path.join(
        dataExtractDir,
        luciBundleRelativePath,
        "ccswitch-provider-ui.js",
      ),
      "utf8",
    );
    const stylesheetSource = readFileSync(
      path.join(
        dataExtractDir,
        luciBundleRelativePath,
        "ccswitch-provider-ui.css",
      ),
      "utf8",
    );

    expectCurrentSpaSentinels(bundleSource, stylesheetSource);
  });
});
