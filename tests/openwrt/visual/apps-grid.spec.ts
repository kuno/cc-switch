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
    assertionText: "Running",
  },
  {
    state: "codex-active",
    screenshot: "apps-grid-codex-active.png",
    assertionText: "Running",
  },
] as const;

const CARD_STATES = [
  {
    state: "default",
    screenshot: "app-card-default.png",
    assertionText: "Standby",
  },
  {
    state: "healthy",
    screenshot: "app-card-healthy.png",
    assertionText: "Standby",
  },
  {
    state: "degraded",
    screenshot: "app-card-degraded.png",
    assertionText: "Standby",
  },
  {
    state: "attention",
    screenshot: "app-card-attention.png",
    assertionText: "Degraded",
  },
  {
    state: "unavailable",
    screenshot: "app-card-unavailable.png",
    assertionText: "Unavailable",
  },
  {
    state: "loading",
    screenshot: "app-card-loading.png",
    assertionText: null,
  },
  {
    state: "not-configured",
    screenshot: "app-card-not-configured.png",
    assertionText: null,
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
    const statusPill = assertionText
      ? page.locator(".owt-status-pill", {
          hasText: assertionText,
        })
      : null;

    if (statusPill) {
      await expect(statusPill).toBeVisible();
    }
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

test("@visual @apps-grid renders exactly five home cards", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=AppsGrid&state=claude-active&theme=${theme}`);

  await expect(page.locator(".owt-app-card[data-app]")).toHaveCount(5);
});

test("@visual @apps-grid shows app reorder drag affordance", async ({
  page,
}, testInfo) => {
  const theme = getTheme(testInfo.project.name);

  await page.goto(`/?component=AppsGrid&state=claude-active&theme=${theme}`);

  const canvas = page.getByTestId("component-canvas");
  const sourceCard = page.locator('.owt-app-card[data-app="gemini"]');
  const targetCard = page.locator('.owt-app-card[data-app="claude"]');

  await expect(sourceCard).toBeVisible();
  await expect(targetCard).toBeVisible();
  await expect(sourceCard.locator(".owt-app-card__drag-handle")).toBeVisible();
  await sourceCard.hover();
  await sourceCard
    .locator(".owt-app-card__drag-handle")
    .evaluate((sourceHandle) => {
      const transfer = new DataTransfer();
      const appWindow = window as Window & {
        __ccswitchAppCardReorderTransfer?: DataTransfer;
      };
      appWindow.__ccswitchAppCardReorderTransfer = transfer;
      sourceHandle.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
  await expect(sourceCard).toHaveAttribute("data-dragging", "true");
  await sourceCard.evaluate((source) => {
    const root = source.getRootNode() as ParentNode;
    const target = root.querySelector('.owt-app-card[data-app="claude"]');

    if (!target) {
      throw new Error("App reorder target card is missing");
    }

    const appWindow = window as Window & {
      __ccswitchAppCardReorderTransfer?: DataTransfer;
    };
    const transfer = appWindow.__ccswitchAppCardReorderTransfer;
    if (!transfer) {
      throw new Error("App reorder drag transfer is missing");
    }

    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * 0.75,
        dataTransfer: transfer,
      }),
    );
  });

  await expect(targetCard).toHaveAttribute("data-drop-position", "after");
  await expect(canvas).toHaveScreenshot("apps-grid-reorder-drag-over.png");
});
