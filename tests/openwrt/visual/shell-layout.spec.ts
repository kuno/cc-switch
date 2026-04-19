import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
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

  test("renders the stopped-shell alert strip", async ({ page }, testInfo) => {
    const theme = getTheme(testInfo.project.name);

    await page.goto(`/?component=shell&state=stopped&theme=${theme}`);

    await expect(page.getByText("Daemon stopped.")).toBeVisible();
    await expect(page).toHaveScreenshot("shell-alert-strip.png");
  });

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
