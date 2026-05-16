import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

async function getShellLayoutMetrics(page: import("@playwright/test").Page) {
  const appsGrid = await page.locator('[data-slot="apps-grid"]').boundingBox();
  const daemonCard = await page
    .locator('[data-slot="daemon-card"]')
    .boundingBox();
  const main = await page.locator(".owt-main").boundingBox();

  if (!appsGrid || !daemonCard || !main) {
    throw new Error("Shell layout metrics are unavailable.");
  }

  return {
    appsGridTop: appsGrid.y,
    daemonCardTop: daemonCard.y,
    mainHeight: main.height,
    scrollHeight: await page.evaluate(
      () => document.documentElement.scrollHeight,
    ),
  };
}

test.describe("@shell OpenWrt page shell", () => {
  test("renders the default shell layout", async ({ page }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=shell&state=default&theme=${theme}`);

    await expect(
      page.getByRole("button", { name: "Open Claude providers" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("shell-default.png");
  });

  test("renders the activity drawer opened from the shell", async ({
    page,
  }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=shell&state=default&theme=${theme}`);

    const openActivityButton = page
      .locator(".owt-app-card__activity-open")
      .first();

    await expect(openActivityButton).toBeVisible();
    await openActivityButton.click();

    await expect(
      page.getByRole("dialog", { name: "Recent activity" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("shell-activity-drawer.png", {
      maxDiffPixelRatio: 0.05,
    });
  });

  test("renders the provider panel opened from the shell", async ({
    page,
  }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=shell&state=default&theme=${theme}`);

    await page.getByRole("button", { name: "Open Claude providers" }).click();

    await expect(
      page.getByRole("dialog", { name: "Claude providers" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("shell-provider-panel.png", {
      maxDiffPixelRatio: 0.03,
    });
  });

  test("renders stopped-shell notification without reserving layout space", async ({
    page,
  }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=shell&state=stopped&theme=${theme}`);

    await expect(page.getByText("Daemon stopped.")).toBeVisible();
    await expect(page.locator(".owt-alert-overlay")).toHaveCount(0);
    await expect(page.locator(".owt-alert-strip")).toHaveCount(0);
    await expect(page.locator(".owt-notification-stack")).toHaveCSS(
      "position",
      "fixed",
    );
    await expect(page.locator(".owt-notification-stack")).toHaveCSS(
      "pointer-events",
      "none",
    );
    await expect(page.locator(".owt-notification-popup")).toHaveCSS(
      "pointer-events",
      "auto",
    );

    const titleRowBox = await page
      .locator(".owt-page__title-row")
      .boundingBox();
    const appsGridBox = await page
      .locator('[data-slot="apps-grid"]')
      .boundingBox();

    if (!titleRowBox || !appsGridBox) {
      throw new Error("Shell layout boxes are unavailable.");
    }

    expect(appsGridBox.y).toBeLessThan(titleRowBox.y + titleRowBox.height + 40);
  });

  test("keeps shell content positions stable when the alert is visible", async ({
    page,
  }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=shell&state=default&theme=${theme}`);
    const hiddenAlertMetrics = await getShellLayoutMetrics(page);

    await page.goto(`/?component=shell&state=stopped&theme=${theme}`);
    await expect(page.getByText("Daemon stopped.")).toBeVisible();
    const visibleAlertMetrics = await getShellLayoutMetrics(page);

    expect(visibleAlertMetrics.appsGridTop).toBeCloseTo(
      hiddenAlertMetrics.appsGridTop,
      1,
    );
    expect(visibleAlertMetrics.daemonCardTop).toBeCloseTo(
      hiddenAlertMetrics.daemonCardTop,
      1,
    );
    expect(visibleAlertMetrics.mainHeight).toBeCloseTo(
      hiddenAlertMetrics.mainHeight,
      1,
    );
    expect(visibleAlertMetrics.scrollHeight).toBe(
      hiddenAlertMetrics.scrollHeight,
    );
  });

  for (const viewport of [
    { label: "wide", width: 1920, height: 1000 },
    { label: "desktop", width: 1280, height: 900 },
    { label: "narrow", width: 720, height: 900 },
  ] as const) {
    test(`keeps notification inside viewport at ${viewport.label} width`, async ({
      page,
    }, testInfo) => {
      const theme = getTheme(testInfo.project.name);

      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto(`/?component=shell&state=stopped&theme=${theme}`);
      await expect(page.getByText("Daemon stopped.")).toBeVisible();

      const notification = await page
        .locator(".owt-notification-popup")
        .boundingBox();

      if (!notification) {
        throw new Error("Notification bounding box unavailable.");
      }

      expect(notification.x).toBeGreaterThanOrEqual(0);
      expect(notification.x + notification.width).toBeLessThanOrEqual(
        viewport.width,
      );
    });
  }

  test("renders the responsive shell at 720px width", async ({
    page,
  }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.setViewportSize({
      width: 720,
      height: 800,
    });
    await page.goto(`/?component=shell&state=default&theme=${theme}`);

    await expect(
      page.getByRole("button", { name: "Open Claude providers" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("shell-default-narrow.png");
  });
});
