import "@/openwrt-provider-ui/openwrt-provider-ui.css";
import { createRoot } from "react-dom/client";
import { HarnessApp } from "./App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Harness root element not found.");
}

createRoot(root).render(<HarnessApp />);
