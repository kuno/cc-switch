import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

const STATES = [
  "closed",
  "preset-tab",
  "claude-presets",
  "codex-presets",
  "gemini-presets",
  "general-empty",
  "general-filled",
  "credentials-empty",
  "credentials-partial",
  "credentials-auth-json",
  "credentials-save-pending",
  "error",
] as const;

for (const state of STATES) {
  test(`@provider-side-panel renders ${state}`, async ({ page }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=ProviderSidePanel&state=${state}&theme=${theme}`);

    const panelShell = page.locator(".owt-provider-panel-shell");
    const panel = page.locator(".owt-provider-panel");

    await expect(panelShell).toBeVisible();
    await expect(panel).toHaveCount(1);
    await page.waitForTimeout(150);
    await expect(panelShell).toHaveScreenshot(
      `provider-side-panel-${state}.png`,
    );
  });
}
