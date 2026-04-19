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

test("@activity-drawer renders the host closed state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=ActivityDrawerHost&state=closed&theme=${theme}`);

  await expect(page.locator(".owt-activity-drawer")).toHaveAttribute(
    "data-open",
    "false",
  );
  await expect(page.getByTestId("component-canvas")).toHaveScreenshot(
    "activity-drawer-host-closed.png",
  );
});

test("@activity-drawer renders the host empty open state", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(
    `/?component=ActivityDrawerHost&state=open-empty&theme=${theme}`,
  );

  await expect(page.locator(".owt-activity-drawer")).toHaveAttribute(
    "data-open",
    "true",
  );
  await expect(
    page.getByText("No recent requests for this filter."),
  ).toBeVisible();
  await expect(page.locator(".owt-activity-drawer__panel")).toHaveScreenshot(
    "activity-drawer-host-open-empty.png",
  );
});
