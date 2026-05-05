import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

type Language = "zh" | "en";

const DEFAULT_LANGUAGE: Language = "en";

const getInitialLanguage = (): Language => {
  const lang =
    typeof document !== "undefined"
      ? (document.documentElement.lang?.toLowerCase() ?? "")
      : "";

  return lang.startsWith("zh") ? "zh" : DEFAULT_LANGUAGE;
};

// OpenWrt v1 supports only English and zh-CN; leave ja unimported so the IIFE stays lean.
const resources = {
  en: {
    translation: en,
  },
  zh: {
    translation: zh,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,

  interpolation: {
    escapeValue: false,
  },

  debug: false,
});

export { i18n };
export default i18n;
