import { parse as parseToml } from "smol-toml";
import {
  providerPresets as claudeProviderPresets,
  type ProviderPreset as ClaudeProviderPreset,
} from "@/config/claudeProviderPresets";
import {
  codexProviderPresets,
  type CodexProviderPreset,
} from "@/config/codexProviderPresets";
import {
  geminiProviderPresets,
  type GeminiProviderPreset,
} from "@/config/geminiProviderPresets";
import type {
  SharedProviderAppId,
  SharedProviderPreset,
  SharedProviderTokenField,
} from "./types";

type SharedPresetSpec = {
  id: string;
  sourcePresetName: string;
  description?: string;
  overrideBaseUrl?: string;
  overrideTokenField?: SharedProviderTokenField;
  overrideModel?: string;
};

const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com";
const CLAUDE_DEFAULT_TOKEN_FIELD = "ANTHROPIC_AUTH_TOKEN";
const CODEX_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const CODEX_DEFAULT_TOKEN_FIELD = "OPENAI_API_KEY";
const CODEX_DEFAULT_MODEL = "gpt-5.4";
const GEMINI_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT_TOKEN_FIELD = "GEMINI_API_KEY";
const GEMINI_DEFAULT_MODEL = "gemini-3.1-pro";
const GENERIC_PRESET_DESCRIPTION = "";

type ClaudeEnv = {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
};

type GeminiEnv = {
  GOOGLE_GEMINI_BASE_URL?: string;
  GEMINI_MODEL?: string;
};

type CodexTomlProvider = {
  base_url?: string;
};

type CodexTomlConfig = {
  model?: string;
  model_providers?: Record<string, CodexTomlProvider>;
};

const OPENWRT_PRESET_SPECS: Record<SharedProviderAppId, SharedPresetSpec[]> = {
  claude: [
    {
      id: "claude-official",
      sourcePresetName: "Claude Official",
      description: "Official Anthropic Claude endpoint.",
      overrideBaseUrl: CLAUDE_DEFAULT_BASE_URL,
    },
    {
      id: "claude-deepseek",
      sourcePresetName: "DeepSeek",
      description: "DeepSeek Claude-compatible endpoint.",
    },
    { id: "claude-zhipu-glm", sourcePresetName: "Zhipu GLM" },
    { id: "claude-zhipu-glm-en", sourcePresetName: "Zhipu GLM en" },
    { id: "claude-bailian", sourcePresetName: "Bailian" },
    { id: "claude-bailian-coding", sourcePresetName: "Bailian For Coding" },
    {
      id: "claude-kimi",
      sourcePresetName: "Kimi",
      description: "Moonshot Kimi Claude-compatible endpoint.",
    },
    { id: "claude-kimi-coding", sourcePresetName: "Kimi For Coding" },
    { id: "claude-modelscope", sourcePresetName: "ModelScope" },
    { id: "claude-longcat", sourcePresetName: "Longcat" },
    {
      id: "claude-minimax",
      sourcePresetName: "MiniMax",
      description: "MiniMax Claude-compatible endpoint.",
    },
    { id: "claude-minimax-en", sourcePresetName: "MiniMax en" },
    { id: "claude-doubaoseed", sourcePresetName: "DouBaoSeed" },
    { id: "claude-bailing", sourcePresetName: "BaiLing" },
    { id: "claude-aihubmix", sourcePresetName: "AiHubMix" },
    { id: "claude-siliconflow", sourcePresetName: "SiliconFlow" },
    { id: "claude-siliconflow-en", sourcePresetName: "SiliconFlow en" },
    { id: "claude-dmxapi", sourcePresetName: "DMXAPI" },
    { id: "claude-packycode", sourcePresetName: "PackyCode" },
    { id: "claude-cubence", sourcePresetName: "Cubence" },
    { id: "claude-aigocode", sourcePresetName: "AIGoCode" },
    { id: "claude-rightcode", sourcePresetName: "RightCode" },
    { id: "claude-aicodemirror", sourcePresetName: "AICodeMirror" },
    { id: "claude-aicoding", sourcePresetName: "AICoding" },
    { id: "claude-crazyrouter", sourcePresetName: "CrazyRouter" },
    { id: "claude-sssaicode", sourcePresetName: "SSSAiCode" },
    { id: "claude-compshare", sourcePresetName: "Compshare" },
    { id: "claude-micu", sourcePresetName: "Micu" },
    { id: "claude-x-code-api", sourcePresetName: "X-Code API" },
    { id: "claude-ctok", sourcePresetName: "CTok.ai" },
    { id: "claude-openrouter", sourcePresetName: "OpenRouter" },
    { id: "claude-novita-ai", sourcePresetName: "Novita AI" },
    { id: "claude-xiaomi-mimo", sourcePresetName: "Xiaomi MiMo" },
  ],
  codex: [
    {
      id: "codex-openai-official",
      sourcePresetName: "OpenAI Official",
      description: "Official OpenAI Responses endpoint for Codex.",
      overrideBaseUrl: CODEX_DEFAULT_BASE_URL,
      overrideModel: CODEX_DEFAULT_MODEL,
    },
    {
      id: "codex-azure-openai",
      sourcePresetName: "Azure OpenAI",
      description:
        "Azure OpenAI Codex endpoint template. Replace YOUR_RESOURCE_NAME before saving.",
    },
    { id: "codex-aihubmix", sourcePresetName: "AiHubMix" },
    { id: "codex-dmxapi", sourcePresetName: "DMXAPI" },
    {
      id: "codex-packycode",
      sourcePresetName: "PackyCode",
      description: "PackyCode Codex-compatible endpoint.",
    },
    { id: "codex-cubence", sourcePresetName: "Cubence" },
    { id: "codex-aigocode", sourcePresetName: "AIGoCode" },
    { id: "codex-rightcode", sourcePresetName: "RightCode" },
    { id: "codex-aicodemirror", sourcePresetName: "AICodeMirror" },
    { id: "codex-aicoding", sourcePresetName: "AICoding" },
    { id: "codex-crazyrouter", sourcePresetName: "CrazyRouter" },
    { id: "codex-sssaicode", sourcePresetName: "SSSAiCode" },
    { id: "codex-compshare", sourcePresetName: "Compshare" },
    { id: "codex-micu", sourcePresetName: "Micu" },
    { id: "codex-x-code-api", sourcePresetName: "X-Code API" },
    { id: "codex-ctok", sourcePresetName: "CTok.ai" },
    {
      id: "codex-openrouter",
      sourcePresetName: "OpenRouter",
      description: "OpenRouter Responses-compatible endpoint for Codex.",
    },
  ],
  gemini: [
    {
      id: "gemini-google-official",
      sourcePresetName: "Google Official",
      description: "Official Google Gemini API endpoint.",
      overrideBaseUrl: GEMINI_DEFAULT_BASE_URL,
      overrideModel: GEMINI_DEFAULT_MODEL,
    },
    {
      id: "gemini-packycode",
      sourcePresetName: "PackyCode",
      description: "PackyCode Gemini-compatible endpoint.",
    },
    { id: "gemini-cubence", sourcePresetName: "Cubence" },
    { id: "gemini-aigocode", sourcePresetName: "AIGoCode" },
    { id: "gemini-aicodemirror", sourcePresetName: "AICodeMirror" },
    { id: "gemini-aicoding", sourcePresetName: "AICoding" },
    { id: "gemini-crazyrouter", sourcePresetName: "CrazyRouter" },
    { id: "gemini-sssaicode", sourcePresetName: "SSSAiCode" },
    {
      id: "gemini-ctok",
      sourcePresetName: "CTok.ai",
      description: "CTok Gemini-compatible endpoint.",
    },
    {
      id: "gemini-openrouter",
      sourcePresetName: "OpenRouter",
      description: "OpenRouter Gemini-compatible endpoint.",
    },
  ],
};

function findClaudePreset(sourcePresetName: string): ClaudeProviderPreset {
  const preset = claudeProviderPresets.find(
    (entry) => entry.name === sourcePresetName,
  );

  if (!preset) {
    throw new Error(`Missing Claude preset source: ${sourcePresetName}`);
  }

  return preset;
}

function findCodexPreset(sourcePresetName: string): CodexProviderPreset {
  const preset = codexProviderPresets.find(
    (entry) => entry.name === sourcePresetName,
  );

  if (!preset) {
    throw new Error(`Missing Codex preset source: ${sourcePresetName}`);
  }

  return preset;
}

function findGeminiPreset(sourcePresetName: string): GeminiProviderPreset {
  const preset = geminiProviderPresets.find(
    (entry) => entry.name === sourcePresetName,
  );

  if (!preset) {
    throw new Error(`Missing Gemini preset source: ${sourcePresetName}`);
  }

  return preset;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function extractClaudePreset(
  spec: SharedPresetSpec,
  preset: ClaudeProviderPreset,
): SharedProviderPreset {
  const env = ((preset.settingsConfig as { env?: ClaudeEnv }).env ??
    {}) as ClaudeEnv;
  const baseUrl =
    spec.overrideBaseUrl ?? env.ANTHROPIC_BASE_URL ?? CLAUDE_DEFAULT_BASE_URL;
  const tokenField =
    spec.overrideTokenField ?? preset.apiKeyField ?? CLAUDE_DEFAULT_TOKEN_FIELD;
  const model = spec.overrideModel ?? env.ANTHROPIC_MODEL ?? "";

  return {
    id: spec.id,
    appId: "claude",
    label: preset.name,
    providerName: preset.name,
    baseUrl,
    tokenField,
    model,
    description: spec.description ?? GENERIC_PRESET_DESCRIPTION,
    sourcePresetName: preset.name,
    supportedOn: {
      desktop: true,
      openwrt: true,
    },
  };
}

function extractCodexPreset(
  spec: SharedPresetSpec,
  preset: CodexProviderPreset,
): SharedProviderPreset {
  const parsed = preset.config
    ? (parseToml(preset.config) as CodexTomlConfig)
    : {};
  const providerMap = parsed.model_providers ?? {};
  const firstProvider = Object.values(providerMap)[0];
  const baseUrl =
    spec.overrideBaseUrl ??
    firstProvider?.base_url ??
    preset.endpointCandidates?.[0] ??
    CODEX_DEFAULT_BASE_URL;
  const model = spec.overrideModel ?? parsed.model ?? CODEX_DEFAULT_MODEL;

  return {
    id: spec.id,
    appId: "codex",
    label: preset.name,
    providerName: preset.name,
    baseUrl,
    tokenField: spec.overrideTokenField ?? CODEX_DEFAULT_TOKEN_FIELD,
    model,
    description: spec.description ?? GENERIC_PRESET_DESCRIPTION,
    sourcePresetName: preset.name,
    supportedOn: {
      desktop: true,
      openwrt: true,
    },
  };
}

function extractGeminiPreset(
  spec: SharedPresetSpec,
  preset: GeminiProviderPreset,
): SharedProviderPreset {
  const env = ((preset.settingsConfig as { env?: GeminiEnv }).env ??
    {}) as GeminiEnv;
  const baseUrl =
    spec.overrideBaseUrl ??
    preset.baseURL ??
    env.GOOGLE_GEMINI_BASE_URL ??
    GEMINI_DEFAULT_BASE_URL;
  const model = spec.overrideModel ?? preset.model ?? env.GEMINI_MODEL ?? "";

  return {
    id: spec.id,
    appId: "gemini",
    label: preset.name,
    providerName: preset.name,
    baseUrl,
    tokenField: spec.overrideTokenField ?? GEMINI_DEFAULT_TOKEN_FIELD,
    model,
    description: spec.description ?? GENERIC_PRESET_DESCRIPTION,
    sourcePresetName: preset.name,
    supportedOn: {
      desktop: true,
      openwrt: true,
    },
  };
}

const SHARED_PRESET_CATALOG: Record<
  SharedProviderAppId,
  SharedProviderPreset[]
> = {
  claude: OPENWRT_PRESET_SPECS.claude.map((spec) =>
    extractClaudePreset(spec, findClaudePreset(spec.sourcePresetName)),
  ),
  codex: OPENWRT_PRESET_SPECS.codex.map((spec) =>
    extractCodexPreset(spec, findCodexPreset(spec.sourcePresetName)),
  ),
  gemini: OPENWRT_PRESET_SPECS.gemini.map((spec) =>
    extractGeminiPreset(spec, findGeminiPreset(spec.sourcePresetName)),
  ),
};

export function getSharedProviderPresetCatalog(): Record<
  SharedProviderAppId,
  SharedProviderPreset[]
> {
  return SHARED_PRESET_CATALOG;
}

export function getSharedProviderPresets(
  appId: SharedProviderAppId,
): SharedProviderPreset[] {
  return SHARED_PRESET_CATALOG[appId];
}

export function getSharedProviderPresetById(
  appId: SharedProviderAppId,
  presetId: string,
): SharedProviderPreset | null {
  return (
    SHARED_PRESET_CATALOG[appId].find((preset) => preset.id === presetId) ??
    null
  );
}

export function inferSharedProviderPresetId(
  appId: SharedProviderAppId,
  payload: Partial<Pick<SharedProviderPreset, "baseUrl" | "tokenField">>,
): string {
  const normalizedBaseUrl = normalizeUrl(payload.baseUrl ?? "");
  const normalizedTokenField = payload.tokenField ?? "";

  for (const preset of SHARED_PRESET_CATALOG[appId]) {
    if (
      normalizeUrl(preset.baseUrl) === normalizedBaseUrl &&
      (!normalizedTokenField || preset.tokenField === normalizedTokenField)
    ) {
      return preset.id;
    }
  }

  return "custom";
}

export function getGenericPresetDescription(): string {
  return "Preset selected. You can still adjust the fields below before saving.";
}

export const OPENWRT_SUPPORTED_PROVIDER_APPS: SharedProviderAppId[] = [
  "claude",
  "codex",
  "gemini",
];
