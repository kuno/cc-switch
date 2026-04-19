import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ProviderView = {
  configured: boolean;
  providerId: string | null;
  name: string;
  baseUrl: string;
  tokenField: string;
  tokenConfigured: boolean;
  tokenMasked: string;
  model: string;
  notes: string;
  active: boolean;
};

type ProviderState = {
  phase2Available: boolean;
  providers: ProviderView[];
  activeProviderId: string | null;
  activeProvider: ProviderView;
};

type SettingsView = {
  emptyProviderView(): ProviderView;
  normalizeProviderView(
    provider: Record<string, unknown>,
    fallbackId: string | null,
    activeProviderId: string | null,
  ): ProviderView;
  parsePhase2ProviderState(
    listResponse: Record<string, unknown> | null,
    activeHint: ProviderView,
  ): ProviderState | null;
};

function loadSettingsView(): SettingsView {
  const source = readFileSync(
    path.resolve(
      process.cwd(),
      "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
    ),
    "utf8",
  );
  const factory = new Function("view", "form", "uci", "rpc", "ui", source);

  return factory(
    {
      extend(definition: SettingsView) {
        return definition;
      },
    },
    {},
    {},
    {
      declare() {
        return () => Promise.resolve({});
      },
    },
    {},
  ) as SettingsView;
}

function makeActiveHint(
  settingsView: SettingsView,
  providerId: string,
  name: string,
): ProviderView {
  return settingsView.normalizeProviderView(
    {
      provider_id: providerId,
      name,
      base_url: `https://${providerId}.example.com`,
    },
    providerId,
    null,
  );
}

describe("LuCI provider state parsing", () => {
  const settingsView = loadSettingsView();

  it("preserves item-level active when phase 2 omits the top-level activeProviderId", () => {
    const state = settingsView.parsePhase2ProviderState(
      {
        providers: [
          { provider_id: "alpha", name: "Alpha", active: true },
          { provider_id: "beta", name: "Beta" },
        ],
      },
      makeActiveHint(settingsView, "beta", "Beta"),
    );

    expect(state?.activeProviderId).toBe("alpha");
    expect(state?.activeProvider.providerId).toBe("alpha");
    expect(state?.providers.find((provider) => provider.providerId === "alpha")?.active).toBe(true);
    expect(state?.providers.find((provider) => provider.providerId === "beta")?.active).toBe(false);
  });

  it("preserves item-level is_current ahead of the phase 1 hint", () => {
    const state = settingsView.parsePhase2ProviderState(
      {
        providers: {
          alpha: { provider_id: "alpha", name: "Alpha" },
          beta: { provider_id: "beta", name: "Beta", is_current: true },
        },
      },
      makeActiveHint(settingsView, "alpha", "Alpha"),
    );

    expect(state?.activeProviderId).toBe("beta");
    expect(state?.activeProvider.providerId).toBe("beta");
    expect(state?.providers.find((provider) => provider.providerId === "beta")?.active).toBe(true);
  });

  it("keeps the phase 1 hint fallback when phase 2 provides no active flags", () => {
    const state = settingsView.parsePhase2ProviderState(
      {
        providers: {
          alpha: { provider_id: "alpha", name: "Alpha" },
          beta: { provider_id: "beta", name: "Beta" },
        },
      },
      makeActiveHint(settingsView, "beta", "Beta"),
    );

    expect(state?.activeProviderId).toBe("beta");
    expect(state?.activeProvider.providerId).toBe("beta");
    expect(state?.providers.find((provider) => provider.providerId === "beta")?.active).toBe(true);
  });
});
