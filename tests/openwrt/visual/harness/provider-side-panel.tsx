import type { ReactElement } from "react";
import { ProviderSidePanel } from "@/openwrt-provider-ui/components/ProviderSidePanel";
import {
  getSharedProviderPresets,
  type SharedProviderAppId,
} from "@/shared/providers/domain";
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
  codexAuth: createCodexAuthSummary({
    accountId: "acct-codex",
  }),
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
        tab: "general",
      }),
  },
  "preset-tab": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        canActivate: false,
        canDelete: false,
        canSave: false,
        draft: createProviderDraft("claude", {
          baseUrl: "",
          model: "",
          name: "",
          notes: "",
        }),
        footerText: "Create a new Claude route from this draft.",
        mode: "new",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: null,
        selectedProviderId: null,
        selectedPresetId: "custom",
        tab: "preset",
        website: "",
      }),
  },
  "claude-presets": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () => {
      const preset = getOfficialPreset("claude");

      return renderPanel({
        appId: "claude",
        canActivate: false,
        canDelete: false,
        canSave: true,
        draft: createDraftFromPreset("claude"),
        footerText: "Create a new Claude route from this draft.",
        mode: "new",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: null,
        selectedProviderId: null,
        selectedPresetId: preset.id,
        tab: "preset",
      });
    },
  },
  "codex-presets": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () => {
      const preset = getOfficialPreset("codex");

      return renderPanel({
        appId: "codex",
        canActivate: false,
        canDelete: false,
        canSave: true,
        draft: createDraftFromPreset("codex"),
        footerText: "Create a new Codex route from this draft.",
        mode: "new",
        providers: PROVIDERS_BY_APP.codex,
        selectedProvider: null,
        selectedProviderId: null,
        selectedPresetId: preset.id,
        tab: "preset",
      });
    },
  },
  "gemini-presets": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () => {
      const preset = getOfficialPreset("gemini");

      return renderPanel({
        appId: "gemini",
        canActivate: false,
        canDelete: false,
        canSave: false,
        draft: createDraftFromPreset("gemini"),
        footerText: "Create a new Gemini route from this draft.",
        mode: "new",
        providers: PROVIDERS_BY_APP.gemini,
        selectedProvider: null,
        selectedProviderId: null,
        selectedPresetId: preset.id,
        tab: "preset",
      });
    },
  },
  "general-empty": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "gemini",
        canActivate: false,
        canDelete: false,
        canSave: false,
        draft: createProviderDraft("gemini", {
          baseUrl: "",
          model: "",
          name: "",
          notes: "",
        }),
        footerText: "Create a new Gemini route from this draft.",
        mode: "new",
        providers: PROVIDERS_BY_APP.gemini,
        selectedProvider: null,
        selectedProviderId: null,
        tab: "general",
        website: "",
      }),
  },
  "general-filled": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        draft: createProviderDraft("claude", {
          authMode: CLAUDE_PRIMARY.authMode,
          baseUrl: CLAUDE_PRIMARY.baseUrl,
          model: CLAUDE_PRIMARY.model,
          name: CLAUDE_PRIMARY.name,
          notes: CLAUDE_PRIMARY.notes,
        }),
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: CLAUDE_PRIMARY,
        selectedProviderId: CLAUDE_PRIMARY.providerId,
        tab: "general",
        website: "https://docs.anthropic.com",
      }),
  },
  "credentials-empty": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        canActivate: false,
        canDelete: false,
        canSave: false,
        draft: createProviderDraft("claude", {
          baseUrl: "",
          model: "",
          name: "",
          notes: "",
          token: "",
        }),
        footerText: "Create a new Claude route from this draft.",
        mode: "new",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: null,
        selectedProviderId: null,
        tab: "credentials",
        website: "",
      }),
  },
  "credentials-partial": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "claude",
        canActivate: false,
        canDelete: false,
        canSave: false,
        draft: createProviderDraft("claude", {
          baseUrl: "https://api.deepseek.com/anthropic",
          model: "DeepSeek-V3.2",
          name: "Claude Backup",
          notes: "",
          token: "",
          tokenField: "ANTHROPIC_API_KEY",
        }),
        footerText: "Create a new Claude route from this draft.",
        mode: "new",
        providers: PROVIDERS_BY_APP.claude,
        selectedProvider: null,
        selectedProviderId: null,
        tab: "credentials",
      }),
  },
  "credentials-auth-json": {
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
        providers: PROVIDERS_BY_APP.codex,
        selectedFileName: "auth.json",
        selectedProvider: CODEX_PRIMARY,
        selectedProviderId: CODEX_PRIMARY.providerId,
        tab: "credentials",
      }),
  },
  "credentials-save-pending": {
    canvasClassName: PANEL_CANVAS_CLASS,
    render: () =>
      renderPanel({
        appId: "codex",
        draft: createProviderDraft("codex", {
          authMode: "api_key",
          baseUrl: "https://proxy.example.com/v1",
          model: "gpt-5.4",
          name: "OpenAI Official",
          token: "sk-provider-secret",
        }),
        providers: [
          createProviderView("codex", {
            active: true,
            authMode: "api_key",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-5.4",
            name: "OpenAI Official",
            providerId: "codex-primary",
          }),
        ],
        savePending: true,
        selectedProvider: createProviderView("codex", {
          active: true,
          authMode: "api_key",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5.4",
          name: "OpenAI Official",
          providerId: "codex-primary",
        }),
        selectedProviderId: "codex-primary",
        tab: "credentials",
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
        tab: "general",
      }),
  },
};
