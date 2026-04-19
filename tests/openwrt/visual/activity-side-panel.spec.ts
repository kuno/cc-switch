import { expect, test } from "@playwright/test";

function getTheme(projectName: string): "light" | "dark" {
  return projectName === "openwrt-dark" ? "dark" : "light";
}

test.use({
  viewport: {
    width: 560,
    height: 820,
  },
});

test("@activity-side-panel renders the populated request list", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(
    `/?component=ActivitySidePanel&state=populated&theme=${theme}`,
  );

  await expect(page.getByText("Anthropic Direct")).toBeVisible();
  await expect(page.locator(".owt-activity-drawer__panel")).toHaveScreenshot(
    "activity-side-panel-populated.png",
  );
});

test("@activity-side-panel renders the request detail view", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=ActivitySidePanel&state=detail&theme=${theme}`);

  await expect(
    page.getByRole("heading", { name: "Request detail" }),
  ).toBeVisible();
  await expect(page.getByText("Token breakdown")).toBeVisible();
  await expect(page.locator(".owt-activity-drawer__panel")).toHaveScreenshot(
    "activity-side-panel-detail.png",
  );
});

test("@activity-side-panel renders the loading state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=ActivitySidePanel&state=loading&theme=${theme}`);

  await expect(page.getByText("Loading recent requests…")).toBeVisible();
  await expect(page.locator(".owt-activity-drawer__panel")).toHaveScreenshot(
    "activity-side-panel-loading.png",
  );
});

test("@activity-side-panel renders the error state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=ActivitySidePanel&state=error&theme=${theme}`);

  await expect(page.getByText("Request log feed unavailable.")).toBeVisible();
  await expect(page.locator(".owt-activity-drawer__panel")).toHaveScreenshot(
    "activity-side-panel-error.png",
  );
});
