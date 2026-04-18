import { useEffect } from "react";
import type { OpenWrtPageTheme } from "@/openwrt-provider-ui/pageTypes";
import { getHarnessRequest, listHarnessComponents, resolveHarnessScenario } from "./entries";
import "./styles.css";

const OPENWRT_PAGE_THEME_DARK_CLASS =
  "ccswitch-openwrt-provider-ui-theme-dark";

function applyTheme(theme: OpenWrtPageTheme) {
  document.body.dataset.ccswitchTheme = theme;
  document.body.classList.toggle(
    OPENWRT_PAGE_THEME_DARK_CLASS,
    theme === "dark",
  );
}

function clearTheme() {
  document.body.classList.remove(OPENWRT_PAGE_THEME_DARK_CLASS);
  delete document.body.dataset.ccswitchTheme;
}

export function HarnessApp() {
  const request = getHarnessRequest(new URL(window.location.href));

  useEffect(() => {
    applyTheme(request.theme);

    return () => {
      clearTheme();
    };
  }, [request.theme]);

  try {
    const scenario = resolveHarnessScenario(request);

    return (
      <main className="ccswitch-openwrt-provider-ui-shell owt-visual-harness">
        <section className="owt-visual-harness__meta">
          <p className="owt-visual-harness__eyebrow">OpenWrt visual harness</p>
          <h1 className="owt-visual-harness__title">{request.component}</h1>
          <p className="owt-visual-harness__detail">
            State: <strong>{request.state}</strong> · Theme:{" "}
            <strong>{request.theme}</strong>
          </p>
        </section>

        <section
          className={`owt-visual-harness__canvas ${scenario.canvasClassName ?? ""}`.trim()}
          data-component={request.component}
          data-state={request.state}
          data-testid="component-canvas"
        >
          {scenario.render()}
        </section>
      </main>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown harness error.";

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
