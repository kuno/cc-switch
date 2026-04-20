import providerUiCss from "@/openwrt-provider-ui/openwrt-provider-ui.css?inline";
import { createRoot } from "react-dom/client";
import { HarnessApp } from "./App";
import harnessCss from "./styles.css?inline";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Harness root element not found.");
}

function createShadowMount(target: HTMLElement): HTMLElement {
  target.dataset.ccswitchProviderUiMount = "page-shell";

  const shadow = target.shadowRoot ?? target.attachShadow({ mode: "open" });

  while (shadow.firstChild) {
    shadow.removeChild(shadow.firstChild);
  }

  const style = document.createElement("style");
  style.textContent = `${providerUiCss}\n${harnessCss}`;
  shadow.appendChild(style);

  const reactMount = document.createElement("div");
  reactMount.className = "ccswitch-openwrt-provider-ui-host";
  reactMount.dataset.ccswitchProviderUiMount = "page-shell";
  shadow.appendChild(reactMount);

  return reactMount;
}

createRoot(createShadowMount(root)).render(<HarnessApp />);
