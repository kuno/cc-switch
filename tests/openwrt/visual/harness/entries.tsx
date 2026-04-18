import type { ReactElement } from "react";
import { AlertStrip } from "@/openwrt-provider-ui/components/AlertStrip";
import type {
  OpenWrtHostState,
  OpenWrtPageTheme,
} from "@/openwrt-provider-ui/pageTypes";

type HarnessScenario = {
  canvasClassName?: string;
  render: () => ReactElement;
};

export type HarnessRequest = {
  component: string;
  state: string;
  theme: OpenWrtPageTheme;
};

const STOPPED_HOST: OpenWrtHostState = {
  app: "claude",
  status: "stopped",
  health: "stopped",
  listenAddr: "127.0.0.1",
  listenPort: "15721",
  version: "3.13.0",
  serviceLabel: "CC Switch",
  httpProxy: "http://127.0.0.1:15721",
  httpsProxy: "http://127.0.0.1:15721",
  proxyEnabled: true,
  logLevel: "info",
};

const HARNESSES: Record<string, Record<string, HarnessScenario>> = {
  AlertStrip: {
    stopped: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () => (
        <AlertStrip
          host={STOPPED_HOST}
          isRunning={false}
          restartInFlight={false}
          message={null}
          onRestart={() => {}}
        />
      ),
    },
  },
};

export function getHarnessRequest(url: URL): HarnessRequest {
  const component = url.searchParams.get("component") ?? "AlertStrip";
  const state = url.searchParams.get("state") ?? "stopped";
  const themeParam = url.searchParams.get("theme");
  const theme: OpenWrtPageTheme = themeParam === "dark" ? "dark" : "light";

  return {
    component,
    state,
    theme,
  };
}

export function resolveHarnessScenario(
  request: HarnessRequest,
): HarnessScenario {
  const componentScenarios = HARNESSES[request.component];

  if (!componentScenarios) {
    throw new Error(`Unknown component "${request.component}".`);
  }

  const scenario = componentScenarios[request.state];

  if (!scenario) {
    throw new Error(
      `Unknown state "${request.state}" for component "${request.component}".`,
    );
  }

  return scenario;
}

export function listHarnessComponents(): string[] {
  return Object.keys(HARNESSES);
}
