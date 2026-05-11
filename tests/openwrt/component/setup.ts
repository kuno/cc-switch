import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import i18n from "@/openwrt-provider-ui/i18n";
import en from "@/openwrt-provider-ui/i18n/locales/en.json";
import zh from "@/openwrt-provider-ui/i18n/locales/zh.json";
import {
  OPENWRT_PAGE_THEME_STORAGE_KEY,
  OPENWRT_PROVIDER_UI_THEME_CLASS,
  OPENWRT_PROVIDER_UI_THEME_DARK_CLASS,
} from "./fixtures/pageShell";

beforeAll(async () => {
  i18n.addResourceBundle("en", "translation", en, true, true);
  i18n.addResourceBundle("zh", "translation", zh, true, true);
  await i18n.changeLanguage("en");
});

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
