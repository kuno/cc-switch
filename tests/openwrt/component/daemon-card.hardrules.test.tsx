import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DaemonCard } from "@/openwrt-provider-ui/components/DaemonCard";
import type { OpenWrtHostState } from "@/openwrt-provider-ui/pageTypes";

const BASE_HOST: OpenWrtHostState = {
  app: "claude",
  status: "running",
  health: "healthy",
  listenAddr: "127.0.0.1",
  listenPort: "15721",
  version: "3.13.0",
  serviceLabel: "CC Switch",
  httpProxy: "http://127.0.0.1:15721",
  httpsProxy: "http://127.0.0.1:15721",
  proxyEnabled: true,
  logLevel: "info",
};

function renderCard(host: Partial<OpenWrtHostState> = {}) {
  const mergedHost = {
    ...BASE_HOST,
    ...host,
  };

  return render(
    <DaemonCard
      host={mergedHost}
      draft={{
        listenAddr: mergedHost.listenAddr,
        listenPort: mergedHost.listenPort,
        httpProxy: mergedHost.httpProxy,
        httpsProxy: mergedHost.httpsProxy,
        logLevel: mergedHost.logLevel,
      }}
      isRunning={mergedHost.status === "running"}
      isDirty={false}
      saveInFlight={false}
      restartInFlight={false}
      restartPending={false}
      message={null}
      messageToneClass=""
      onDraftChange={() => {}}
      onSave={() => {}}
      onRestart={() => {}}
    />,
  );
}

describe("DaemonCard hard rules", () => {
  it.each([
    {
      name: "running",
      host: {
        status: "running",
        health: "healthy",
      },
    },
    {
      name: "stopped",
      host: {
        status: "stopped",
        health: "stopped",
      },
    },
    {
      name: "restarting",
      host: {
        status: "running",
        health: "healthy",
      },
    },
    {
      name: "unknown",
      host: {
        status: "running",
        health: "unknown",
      },
    },
  ] satisfies Array<{
    name: string;
    host: Partial<OpenWrtHostState>;
  }>)("never reintroduces legacy provider UI in the $name state", ({ host }) => {
    const { container } = renderCard(host);

    expect(screen.queryByText(/Failover/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenClaw/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hermes/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Configure routes and provider details"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /failover/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /queue|order|move up|move down/i }),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".owt-legacy-preserved")).toBeNull();
  });
});
