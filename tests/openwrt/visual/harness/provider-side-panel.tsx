import type { ReactElement } from "react";
import { ProviderSidePanel } from "@/openwrt-provider-ui/components/ProviderSidePanel";
import {
  getSharedProviderPresets,
  type SharedProviderAppId,
} from "@/shared/providers/domain";
import {
  createPlainPageShellBridge,
  REALISTIC_HOST_STATE,
} from "../../component/fixtures/pageShell";
import {
  createCodexAuthSummary,
  createProviderDraft,
  createProviderSidePanelProps,
  createProviderView,
} from "../../provider-panel-fixtures";

type ProviderSidePanelHarnessScenario = {
  canvasClassName?: string;
  render: () => ReactElement;
};

const PANEL_CANVAS_CLASS = "owt-visual-harness__canvas--panel";

const CLAUDE_PRIMARY = createProviderView("claude", {
  active: true,
  authMode: "client_passthrough",
  baseUrl: "https://api.anthropic.com",
  model: "claude-sonnet-4-5",
  name: "Claude Primary",
  notes: "Pinned for router traffic",
  providerId: "claude-primary",
});

const CLAUDE_BACKUP = createProviderView("claude", {
  active: false,
  baseUrl: "https://api.deepseek.com/anthropic",
  model: "DeepSeek-V3.2",
  name: "Claude Backup",
  providerId: "claude-backup",
  tokenConfigured: false,
  tokenField: "ANTHROPIC_API_KEY",
});

const CODEX_PRIMARY = createProviderView("codex", {
  active: true,
  authMode: "codex_oauth",
  baseUrl: "https://api.openai.com/v1",
  codexAuth: createCodexAuthSummary(),
  model: "gpt-5.4",
  name: "OpenAI Official",
  providerId: "codex-primary",
});

const GEMINI_PRIMARY = createProviderView("gemini", {
  active: true,
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-2.5-pro",
  name: "Gemini Primary",
  providerId: "gemini-primary",
});

const PROVIDERS_BY_APP: Record<SharedProviderAppId, ReturnType<typeof createProviderView>[]> = {
  claude: [CLAUDE_PRIMARY, CLAUDE_BACKUP],
  codex: [CODEX_PRIMARY],
  gemini: [GEMINI_PRIMARY],
};

function createActivityShell(appId: SharedProviderAppId, providerId: string) {
  return createPlainPageShellBridge({
    host: {
      ...REALISTIC_HOST_STATE,
      app: appId,
    },
    requestLogs: {
      claude: [],
      codex: [],
      gemini: [],
      [appId]: [
        {
          appType: appId,
          cacheCreationCostUsd: "0",
          cacheCreationTokens: 0,
          cacheReadCostUsd: "0",
          cacheReadTokens: 0,
          costMultiplier: "1",
          createdAt: Date.now(),
          inputCostUsd: "0.01",
          inputTokens: 120,
          isStreaming: false,
          latencyMs: 240,
          model: appId === "codex" ? "gpt-5.4" : "claude-sonnet-4-5",
          outputCostUsd: "0.02",
          outputTokens: 180,
          providerId,
          providerName:
            PROVIDERS_BY_APP[appId].find(
              (provider) => provider.providerId === providerId,
            )?.name ?? providerId,
          requestId: `${providerId}-req-1`,
          statusCode: 200,
          totalCostUsd: "0.03",
        },
      ],
    },
  });
}

function createStatisticsShell(appId: SharedProviderAppId, providerId: string) {
  const shell = createActivityShell(appId, providerId);
  const providerName =
    PROVIDERS_BY_APP[appId].find((provider) => provider.providerId === providerId)
      ?.name ?? providerId;

  shell.getStatus = async () => ({
    apps: {
      [appId]: {
        maxRetries: 3,
        providers: {
          [providerId]: {
            name: providerName,
            stats: {
              avgLatencyMs: 684,
              requestCount: 111,
              successRate: 87.5,
              totalCost: "1.01",
              totalTokens: 236_400,
            },
            quota: {
              tokensRemaining: 42_000,
              tokensLimit: 100_000,
              windows: [
                {
                  name: "five_hour",
                  utilization: 0.42,
                },
                {
                  name: "weekly_limit",
                  utilization: 0.18,
                },
              ],
            },
          },
        },
      },
    },
  });

  return shell;
}

function getOfficialPreset(appId: SharedProviderAppId) {
  return getSharedProviderPresets(appId)[0];
}

function createDraftFromPreset(appId: SharedProviderAppId) {
  const preset = getOfficialPreset(appId);

  return createProviderDraft(appId, {
    authMode: preset.authMode,
    baseUrl: preset.baseUrl,
    model: preset.model,
    name: preset.providerName,
    notes: "",
    tokenField: preset.tokenField,
    token: "",
  });
}

function renderPanel(
  options: Parameters<typeof createProviderSidePanelProps>[0] = {},
) {
  return (
    <div className="owt-provider-panel-harness-root">
      <ProviderSidePanel {...createProviderSidePanelProps(options)} />
    </div>
  );
}

export const PROVIDER_SIDE_PANEL_HARNESSES: Record<
  string,
  ProviderSidePanelHarnessScenario
> = {
  closed: {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        open: false,
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: CLAUDE_PRIMARY,
        selectedProviderId: CLAUDE_PRIMARY.providerId,
        tab: "activities",
      }),
  },
  "preset-picker": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        canDelete: false,
        canSave: false,
        draft: createProviderDraft("claude", {
          baseUrl: "",
          model: "",
          name: "",
          notes: "",
        }),
        mode: "new",
        panelMode: "preset-picker",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: null,
        selectedProviderId: null,
        selectedPresetId: "custom",
      }),
  },
  activities: {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: CLAUDE_PRIMARY,
        selectedProviderId: CLAUDE_PRIMARY.providerId,
        shell: createActivityShell("claude", "claude-primary"),
        tab: "activities",
      }),
  },
  statistics: {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: CLAUDE_PRIMARY,
        selectedProviderId: CLAUDE_PRIMARY.providerId,
        shell: createStatisticsShell("claude", "claude-primary"),
        tab: "statistics",
      }),
  },
  "configure-read": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        editing: false,
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: CLAUDE_PRIMARY,
        selectedProviderId: CLAUDE_PRIMARY.providerId,
        tab: "configure",
      }),
  },
  "configure-edit": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        editing: true,
        footerText: "Unsaved changes",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: CLAUDE_PRIMARY,
        selectedProviderId: CLAUDE_PRIMARY.providerId,
        tab: "configure",
      }),
  },
  "configure-authjson": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "codex",
        draft: createProviderDraft("codex", {
          authMode: "codex_oauth",
          baseUrl: CODEX_PRIMARY.baseUrl,
          model: CODEX_PRIMARY.model,
          name: CODEX_PRIMARY.name,
        }),
        editing: true,
        footerText: "Unsaved changes",
        providers: PROVIDERS_BY_APP.codex,
        selectedProvider: CODEX_PRIMARY,
        selectedProviderId: CODEX_PRIMARY.providerId,
        tab: "configure",
      }),
  },
  "new-draft": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "gemini",
        draft: createDraftFromPreset("gemini"),
        editing: true,
        footerText: "New provider · not saved",
        mode: "new",
        providers: PROVIDERS_BY_APP.gemini,
        selectedProvider: null,
        selectedProviderId: null,
        tab: "configure",
      }),
  },
  error: {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        error: "Failed to load provider workspace.",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: CLAUDE_PRIMARY,
        selectedProviderId: CLAUDE_PRIMARY.providerId,
        tab: "configure",
      }),
  },
};
