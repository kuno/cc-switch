import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

function getHarnessUrl(state: string, theme: "light" | "dark"): string {
  return `/?component=AppNotification&state=${state}&theme=${theme}`;
}

test("@smoke @app-notification renders the stopped state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(getHarnessUrl("stopped", theme));

  const notification = page.getByTestId("component-canvas");

  await expect(page.getByText("Daemon stopped.")).toBeVisible();
  await expect(notification).toHaveScreenshot("app-notification-stopped.png");
});

test("@app-notification stays hidden when there are no notifications", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(getHarnessUrl("healthy", theme));

  await expect(page.locator(".owt-notification-popup")).toHaveCount(0);
  await expect(page.locator(".owt-alert-strip")).toHaveCount(0);
});

for (const scenario of [
  {
    state: "unreachable",
    title: "Daemon not reachable.",
    screenshot: "app-notification-unreachable.png",
  },
  {
    state: "restarting",
    title: "Restarting daemon…",
    screenshot: "app-notification-restarting.png",
  },
  {
    state: "restart-failed",
    title: "Restart failed:",
    screenshot: "app-notification-restart-failed.png",
  },
]) {
  test(`@app-notification renders the ${scenario.state} state`, async ({
    page,
  }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(getHarnessUrl(scenario.state, theme));

    const notification = page.locator(".owt-notification-popup");

    await expect(notification).toContainText(scenario.title);
    await expect(page.getByTestId("component-canvas")).toHaveScreenshot(
      scenario.screenshot,
    );
  });
}

test("@app-notification wraps long messages without horizontal overflow", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(getHarnessUrl("restart-failed-long", theme));

  const canvas = page.getByTestId("component-canvas");
  const notification = page.locator(".owt-notification-popup");
  const canvasOverflow = await canvas.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  const notificationOverflow = await notification.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));

  await expect(notification).toContainText("Restart failed:");
  expect(canvasOverflow.scrollWidth).toBeLessThanOrEqual(
    canvasOverflow.clientWidth,
  );
  expect(notificationOverflow.scrollWidth).toBeLessThanOrEqual(
    notificationOverflow.clientWidth,
  );
  await expect(canvas).toHaveScreenshot("app-notification-restart-failed-long.png");
});
