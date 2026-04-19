import { createRoot } from "react-dom/client";
import { DaemonCardIsland } from "./DaemonCardIsland";

function mount() {
  const target = document.getElementById("ccswitch-daemon-island");
  if (!target) {
    console.warn("[ccswitch] daemon island mount point not found");
    return;
  }
  const root = createRoot(target);
  root.render(<DaemonCardIsland />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
