import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

const SCENARIOS = [
  "running",
  "stopped",
  "pending",
  "restarting",
  "error",
] as const;

for (const state of SCENARIOS) {
  test(`@daemon-card renders the ${state} state`, async ({ page }, testInfo) => {
    test.slow();

    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=DaemonCard&state=${state}&theme=${theme}`, {
      waitUntil: "domcontentloaded",
    });

    const canvas = page.getByTestId("component-canvas");
    const daemonCard = canvas.locator(".owt-daemon-card");

    await expect(page.locator("body")).toHaveAttribute(
      "data-ccswitch-theme",
      theme,
      {
        timeout: 15_000,
      },
    );
    await expect(canvas).toBeVisible();
    await expect(daemonCard).toBeVisible({ timeout: 15_000 });
    await expect(daemonCard).toHaveScreenshot(`daemon-card-${state}.png`, {
      timeout: 30_000,
    });
  });
}
