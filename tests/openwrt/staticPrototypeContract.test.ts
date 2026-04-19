import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

type JSDOMInstance = ReturnType<typeof JSDOM>;
type DomNode = Element | DocumentFragment | null;

const PROTOTYPE_PATH = path.resolve(
  process.cwd(),
  "docs/openwrt-b24-artifacts/prototype/index.html",
);

let activeDom: JSDOMInstance | null = null;

function loadPrototype(search = "") {
  const dom = new JSDOM(readFileSync(PROTOTYPE_PATH, "utf8"), {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: `https://example.test/openwrt-b24-artifacts/prototype/index.html${search}`,
  });

  activeDom = dom;
  return dom;
}

function normalizeText(node: unknown) {
	const candidate = node as DomNode;
	return candidate?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeValue(node: Element | null) {
  if (node && "value" in node) {
    const value = (node as Element & { value?: string }).value;

    if (typeof value === "string") {
      return value.trim();
    }
  }

  return normalizeText(node);
}

function normalizeWithValues(node: Element | null) {
  const text = normalizeText(node);
  const values = Array.from(
    node?.querySelectorAll("input, select, textarea") ?? [],
  )
    .map((element) => normalizeValue(element))
    .filter(Boolean)
    .join(" ");

  return `${text} ${values}`.replace(/\s+/g, " ").trim();
}

function expectContainsParts(haystack: string, parts: string[]) {
  parts.forEach((part) => {
    expect(haystack).toContain(part);
  });
}

function click(dom: JSDOMInstance, element: unknown) {
	const candidate = element as DomNode;
	expect(element).not.toBeNull();
	candidate?.dispatchEvent(
    new dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }),
  );
}

function getWorkspaceButton(dom: JSDOMInstance, label: string) {
  return Array.from(
    dom.window.document.querySelectorAll("#detailWorkspaceSwitcher button"),
  ).find((button) => normalizeText(button) === label);
}

function getDetailTab(dom: JSDOMInstance, label: string) {
  return Array.from(dom.window.document.querySelectorAll("#sectionTabs .tag")).find(
    (button) => normalizeText(button) === label,
  );
}

async function settle(dom: JSDOMInstance) {
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
}

function postLivePayload(dom: JSDOMInstance) {
  dom.window.dispatchEvent(
    new dom.window.MessageEvent("message", {
      data: {
        type: "ccswitch-prototype-live-data",
        payload: {
          apps: {
            claude: { activeProviderId: null, providers: [] },
            codex: {
              activeProviderId: "codex-primary",
              providers: [
                {
                  providerId: "codex-primary",
                  name: "OpenAI Official",
                  baseUrl: "https://api.openai.com/v1",
                  tokenField: "OPENAI_API_KEY",
                  tokenConfigured: true,
                  tokenMasked: "sk-live-...789",
                  model: "gpt-5.4",
                  notes: "Pinned live route",
                  active: true,
                  failover: {
                    providerId: "codex-primary",
                    proxyEnabled: false,
                    autoFailoverEnabled: true,
                    maxRetries: 9,
                    activeProviderId: "live-active-provider-id",
                    inFailoverQueue: true,
                    queuePosition: 7,
                    sortIndex: 7,
                    providerHealth: {
                      providerId: "codex-primary",
                      observed: true,
                      healthy: false,
                      consecutiveFailures: 3,
                      lastSuccessAt: "2026-04-13T07:59:00Z",
                      lastFailureAt: "2026-04-13T08:00:00Z",
                      lastError: "live-failover-last-error",
                      updatedAt: "2026-04-13T08:01:00Z",
                    },
                    failoverQueueDepth: 2,
                    failoverQueue: [
                      {
                        providerId: "failover-payload-backup",
                        providerName: "Live Failover Backup",
                        sortIndex: 1,
                        active: false,
                        health: {
                          providerId: "failover-payload-backup",
                          observed: true,
                          healthy: true,
                        },
                      },
                    ],
                  },
                },
              ],
            },
            gemini: { activeProviderId: null, providers: [] },
          },
        },
      },
    }),
  );
}

afterEach(() => {
  activeDom?.window.close();
  activeDom = null;
});

describe("OpenWrt static prototype contract", () => {
  it("consumes live host query params plus General, Credentials, and Failover fields from the live payload", async () => {
    const dom = loadPrototype(
      "?app=codex&status=running&health=degraded&listen_addr=10.0.0.5&listen_port=18443&service_label=Router%20daemon&http_proxy=http%3A%2F%2Frouter-http.internal%3A7890&https_proxy=http%3A%2F%2Frouter-https.internal%3A7890&proxy_enabled=0&log_level=debug",
    );

    await settle(dom);
    postLivePayload(dom);
    await settle(dom);

    const { document } = dom.window;
    const fieldGridSnapshot = () =>
      normalizeWithValues(document.getElementById("fieldGrid"));

    expect(normalizeText(document.getElementById("daemonStatusText"))).toBe(
      "Running",
    );
    expect(normalizeText(document.getElementById("daemonHealthChip"))).toBe(
      "Degraded",
    );
    expect(normalizeText(document.getElementById("listenEndpointValue"))).toBe(
      "10.0.0.5:18443",
    );
    expect(normalizeValue(document.getElementById("listenAddressValue"))).toBe(
      "10.0.0.5",
    );
    expect(normalizeValue(document.getElementById("listenPortValue"))).toBe(
      "18443",
    );
    expect(normalizeValue(document.getElementById("httpProxyValue"))).toBe(
      "http://router-http.internal:7890",
    );
    expect(normalizeValue(document.getElementById("httpsProxyValue"))).toBe(
      "http://router-https.internal:7890",
    );
    expect(normalizeText(document.getElementById("serviceLabelValue"))).toBe(
      "Router daemon",
    );
    expect(normalizeValue(document.getElementById("loggingValue"))).toBe(
      "debug",
    );

    expect(document.querySelectorAll(".provider-row")).toHaveLength(1);
    expect(normalizeText(document.getElementById("providerList"))).toContain(
      "OpenAI Official",
    );
    expect(normalizeText(document.getElementById("providerList"))).not.toContain(
      "Azure OpenAI",
    );
    expect(normalizeText(document.getElementById("editorSubtitle"))).toBe(
      "General provider settings for the Codex workspace",
    );
    expectContainsParts(fieldGridSnapshot(), [
      "Provider name",
      "OpenAI Official",
      "Notes",
      "Pinned live route",
      "Base URL",
      "https://api.openai.com/v1",
    ]);

    click(dom, getDetailTab(dom, "Endpoint"));
    await settle(dom);

    expectContainsParts(fieldGridSnapshot(), [
      "Credential status",
      "sk-live-...789",
    ]);

    click(dom, getDetailTab(dom, "Model"));
    await settle(dom);

    expectContainsParts(fieldGridSnapshot(), [
      "Token field",
      "OPENAI_API_KEY",
      "Model",
      "gpt-5.4",
    ]);

    click(dom, getWorkspaceButton(dom, "Credentials"));
    await settle(dom);

    expect(normalizeText(document.getElementById("editorSubtitle"))).toBe(
      "Credential settings for the Codex workspace",
    );
    expectContainsParts(fieldGridSnapshot(), [
      "Secret policy",
      "Blank preserves stored secret",
      "Primary env key",
      "OPENAI_API_KEY",
      "sk-live-...789",
    ]);

    click(dom, getDetailTab(dom, "Endpoint"));
    await settle(dom);

    expectContainsParts(fieldGridSnapshot(), [
      "Base URL env",
      "https://api.openai.com/v1",
      "Model env",
      "gpt-5.4",
    ]);

    click(dom, getDetailTab(dom, "Notes"));
    await settle(dom);

    expectContainsParts(fieldGridSnapshot(), ["Notes", "Pinned live route"]);

    click(dom, getWorkspaceButton(dom, "Failover"));
    await settle(dom);

    expect(normalizeText(document.getElementById("editorSubtitle"))).toBe(
      "Failover settings for the Codex workspace",
    );
    expect(normalizeText(document.getElementById("summaryCard"))).toContain(
      "Failover status Enabled · 2 queued · position 8",
    );
    expectContainsParts(fieldGridSnapshot(), [
      "Provider ID",
      "codex-primary",
      "Queue membership",
      "Queued",
      "Queue position",
      "8",
      "Queue sort index",
      "7",
      "Queue depth",
      "2",
      "Queue order",
      "Live Failover Backup",
      "standby",
      "healthy",
      "sort 1",
    ]);
    expect(fieldGridSnapshot()).not.toContain(
      "Placeholder",
    );

    click(dom, getDetailTab(dom, "Health"));
    await settle(dom);

    expectContainsParts(fieldGridSnapshot(), [
      "Provider health",
      "Unhealthy",
      "Health observed",
      "Yes",
      "Consecutive failures",
      "3",
    ]);

    click(dom, getDetailTab(dom, "Policy"));
    await settle(dom);

    expectContainsParts(fieldGridSnapshot(), [
      "Proxy enabled",
      "Disabled",
      "Auto failover",
      "Enabled",
      "Max retries",
      "9",
      "Active provider ID",
      "live-active-provider-id",
    ]);

    click(dom, getDetailTab(dom, "Notes"));
    await settle(dom);

    expectContainsParts(fieldGridSnapshot(), [
      "Last success",
      "2026-04-13T07:59:00Z",
      "Last failure",
      "2026-04-13T08:00:00Z",
      "Last error",
      "live-failover-last-error",
      "Runtime updated",
      "2026-04-13T08:01:00Z",
    ]);
  });

  it("keeps Add, Duplicate, and Save actions explicitly mock-local", async () => {
    const dom = loadPrototype("?app=codex");

    await settle(dom);
    postLivePayload(dom);
    await settle(dom);

    const { document } = dom.window;
    const duplicateButton = document.querySelectorAll(".action-row button")[0];
    const editorSaveButton = document.querySelectorAll(".action-row button")[1];
    const footerSaveButton = document.querySelectorAll(
      ".footer-actions .primary",
    )[0];
    const addButton = document.querySelector(".toolbar-add");

    click(dom, editorSaveButton);
    await settle(dom);
    expect(normalizeText(document.getElementById("toast"))).toBe(
      "Save stays placeholder-only in this prototype",
    );

    click(dom, footerSaveButton);
    await settle(dom);
    expect(normalizeText(document.getElementById("toast"))).toBe(
      "Save stays placeholder-only in this prototype",
    );

    click(dom, duplicateButton);
    await settle(dom);
    expect(normalizeText(document.getElementById("toast"))).toBe(
      "Duplicate stays placeholder-only in this prototype",
    );

    click(dom, addButton);
    await settle(dom);

    const modalName = document.getElementById("modalName") as HTMLInputElement;
    modalName.value = "Draft From Modal";

    click(dom, document.getElementById("modalSave"));
    await settle(dom);

    expect(normalizeText(document.getElementById("toast"))).toBe(
      "Add draft stays placeholder-only in this prototype",
    );
    expect(normalizeText(document.getElementById("providerList"))).not.toContain(
      "OpenAI Official copy",
    );
    expect(normalizeText(document.getElementById("providerList"))).toContain(
      "OpenAI Official",
    );
    expect(normalizeText(document.getElementById("providerList"))).not.toContain(
      "Draft From Modal",
    );
  });
});
