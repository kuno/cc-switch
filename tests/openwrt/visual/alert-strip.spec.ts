import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

function getHarnessUrl(state: string, theme: "light" | "dark"): string {
  return `/?component=AlertStrip&state=${state}&theme=${theme}`;
}

test("@smoke @alert-strip renders the stopped state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(getHarnessUrl("stopped", theme));

  const alertStrip = page.getByTestId("component-canvas");

  await expect(page.getByText("Daemon stopped.")).toBeVisible();
  await expect(alertStrip).toHaveScreenshot("alert-strip-stopped.png");
});

test("@alert-strip stays hidden when the daemon is healthy", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(getHarnessUrl("healthy", theme));

  await expect(page.locator(".owt-alert-strip")).toHaveCount(0);
});

for (const scenario of [
  {
    state: "unreachable",
    title: "Daemon not reachable.",
    screenshot: "alert-strip-unreachable.png",
  },
  {
    state: "restarting",
    title: "Restarting daemon…",
    screenshot: "alert-strip-restarting.png",
  },
  {
    state: "restart-failed",
    title: "Restart failed:",
    screenshot: "alert-strip-restart-failed.png",
  },
]) {
  test(`@alert-strip renders the ${scenario.state} state`, async ({
    page,
  }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(getHarnessUrl(scenario.state, theme));

    const alertStrip = page.locator(".owt-alert-strip");

    await expect(alertStrip).toContainText(scenario.title);
    await expect(page.getByTestId("component-canvas")).toHaveScreenshot(
      scenario.screenshot,
    );
  });
}

test("@alert-strip wraps long failure messages without horizontal overflow", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(getHarnessUrl("restart-failed-long", theme));

  const canvas = page.getByTestId("component-canvas");
  const alertStrip = page.locator(".owt-alert-strip");
  const canvasOverflow = await canvas.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  const alertOverflow = await alertStrip.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));

  await expect(alertStrip).toContainText("Restart failed:");
  expect(canvasOverflow.scrollWidth).toBeLessThanOrEqual(
    canvasOverflow.clientWidth,
  );
  expect(alertOverflow.scrollWidth).toBeLessThanOrEqual(
    alertOverflow.clientWidth,
  );
  await expect(canvas).toHaveScreenshot("alert-strip-restart-failed-long.png");
});
