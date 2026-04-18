import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

test("@smoke @alert-strip renders the stopped state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=AlertStrip&state=stopped&theme=${theme}`);

  const alertStrip = page.getByTestId("component-canvas");

  await expect(page.getByText("Daemon stopped.")).toBeVisible();
  await expect(alertStrip).toHaveScreenshot("alert-strip-stopped.png");
});
