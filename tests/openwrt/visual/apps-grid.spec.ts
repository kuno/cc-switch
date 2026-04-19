import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

const GRID_STATES = [
  {
    state: "default",
    screenshot: "apps-grid-default.png",
    assertionText: "Stopped",
  },
  {
    state: "claude-active",
    screenshot: "apps-grid-claude-active.png",
    assertionText: "Healthy",
  },
  {
    state: "codex-active",
    screenshot: "apps-grid-codex-active.png",
    assertionText: "Healthy",
  },
] as const;

const CARD_STATES = [
  {
    state: "default",
    screenshot: "app-card-default.png",
    assertionText: "Ready",
  },
  {
    state: "healthy",
    screenshot: "app-card-healthy.png",
    assertionText: "Healthy",
  },
  {
    state: "degraded",
    screenshot: "app-card-degraded.png",
    assertionText: "Degraded",
  },
  {
    state: "attention",
    screenshot: "app-card-attention.png",
    assertionText: "Attention",
  },
  {
    state: "unavailable",
    screenshot: "app-card-unavailable.png",
    assertionText: "Unavailable",
  },
  {
    state: "loading",
    screenshot: "app-card-loading.png",
    assertionText: "Loading",
  },
  {
    state: "not-configured",
    screenshot: "app-card-not-configured.png",
    assertionText: "Not configured",
  },
] as const;

for (const { state, screenshot, assertionText } of GRID_STATES) {
  test(`@visual @apps-grid renders ${state}`, async ({ page }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=AppsGrid&state=${state}&theme=${theme}`);

    const canvas = page.getByTestId("component-canvas");
    const statusPill = page
      .locator(".owt-status-pill", { hasText: assertionText })
      .first();

    await expect(statusPill).toBeVisible();
    await expect(canvas).toHaveScreenshot(screenshot);
  });
}

for (const { state, screenshot, assertionText } of CARD_STATES) {
  test(`@visual @app-card renders ${state}`, async ({ page }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=AppCard&state=${state}&theme=${theme}`);

    const card = page.locator(".owt-app-card");
    const statusPill = page.locator(".owt-status-pill", {
      hasText: assertionText,
    });

    await expect(statusPill).toBeVisible();
    await expect(card).toHaveScreenshot(screenshot);
  });
}

test("@visual @app-card renders hover state", async ({ page }, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=AppCard&state=default&theme=${theme}`);

  const card = page.locator(".owt-app-card");
  const trigger = page.getByRole("button", { name: "Open Claude providers" });

  await trigger.hover();

  await expect(card).toHaveScreenshot("app-card-hover.png");
});

test("@visual @app-card renders focus-visible state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=AppCard&state=default&theme=${theme}`);

  const card = page.locator(".owt-app-card");
  const trigger = page.getByRole("button", { name: "Open Claude providers" });

  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();

  await expect(card).toHaveScreenshot("app-card-focus-visible.png");
});

test("@visual @apps-grid renders exactly three cards", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=AppsGrid&state=claude-active&theme=${theme}`);

  await expect(page.locator(".owt-app-card")).toHaveCount(3);
});
