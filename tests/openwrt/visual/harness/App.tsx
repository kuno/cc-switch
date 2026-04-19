import { useEffect, useState } from "react";
import type { OpenWrtPageTheme } from "@/openwrt-provider-ui/pageTypes";
import {
  OPENWRT_PAGE_FIXED_NOW,
  OPENWRT_PAGE_THEME_STORAGE_KEY,
  OPENWRT_PROVIDER_UI_THEME_CLASS,
} from "../../component/fixtures/pageShell";
import {
  getHarnessRequest,
  listHarnessComponents,
  resolveHarnessScenario,
} from "./entries";
import "./styles.css";

const OPENWRT_PAGE_THEME_DARK_CLASS = "ccswitch-openwrt-provider-ui-theme-dark";

function applyTheme(theme: OpenWrtPageTheme) {
  document.body.classList.add(OPENWRT_PROVIDER_UI_THEME_CLASS);
  document.body.dataset.ccswitchTheme = theme;
  document.body.classList.toggle(
    OPENWRT_PAGE_THEME_DARK_CLASS,
    theme === "dark",
  );
}

function clearTheme() {
  document.body.classList.remove(OPENWRT_PROVIDER_UI_THEME_CLASS);
  document.body.classList.remove(OPENWRT_PAGE_THEME_DARK_CLASS);
  delete document.body.dataset.ccswitchTheme;
}

export function HarnessApp() {
  const request = getHarnessRequest(new URL(window.location.href));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalDateNow = Date.now;
    Date.now = () => OPENWRT_PAGE_FIXED_NOW;
    window.localStorage.setItem(OPENWRT_PAGE_THEME_STORAGE_KEY, request.theme);
    applyTheme(request.theme);
    setReady(true);

    return () => {
      setReady(false);
      Date.now = originalDateNow;
      window.localStorage.removeItem(OPENWRT_PAGE_THEME_STORAGE_KEY);
      clearTheme();
    };
  }, [request.theme]);

  if (!ready) {
    return null;
  }

  try {
    const scenario = resolveHarnessScenario(request);
    const shellCanvas = request.component === "shell";

    return (
      <main
        className={`ccswitch-openwrt-provider-ui-shell owt-visual-harness${
          shellCanvas ? " owt-visual-harness--fullscreen" : ""
        }`}
      >
        {shellCanvas ? null : (
          <section className="owt-visual-harness__meta">
            <p className="owt-visual-harness__eyebrow">
              OpenWrt visual harness
            </p>
            <h1 className="owt-visual-harness__title">{request.component}</h1>
            <p className="owt-visual-harness__detail">
              State: <strong>{request.state}</strong> · Theme:{" "}
              <strong>{request.theme}</strong>
            </p>
          </section>
        )}

        <section
          className={`owt-visual-harness__canvas ${scenario.canvasClassName ?? ""}`.trim()}
          data-component={request.component}
          data-state={request.state}
          data-testid="component-canvas"
        >
          {scenario.render(request)}
        </section>
      </main>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown harness error.";

    return (
      <main className="ccswitch-openwrt-provider-ui-shell owt-visual-harness">
        <section className="owt-visual-harness__meta">
          <p className="owt-visual-harness__eyebrow">OpenWrt visual harness</p>
          <h1 className="owt-visual-harness__title">Invalid scenario</h1>
          <p className="owt-visual-harness__detail">{message}</p>
          <p className="owt-visual-harness__detail">
            Available entries: {listHarnessComponents().join(", ")}
          </p>
        </section>
      </main>
    );
  }
}
