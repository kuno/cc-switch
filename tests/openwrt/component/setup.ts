import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  OPENWRT_PAGE_THEME_STORAGE_KEY,
  OPENWRT_PROVIDER_UI_THEME_CLASS,
  OPENWRT_PROVIDER_UI_THEME_DARK_CLASS,
} from "./fixtures/pageShell";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  document.body.classList.remove(
    "dark",
    OPENWRT_PROVIDER_UI_THEME_CLASS,
    OPENWRT_PROVIDER_UI_THEME_DARK_CLASS,
  );
  delete document.body.dataset.ccswitchTheme;
  window.localStorage.removeItem(OPENWRT_PAGE_THEME_STORAGE_KEY);
});
