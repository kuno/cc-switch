import { providerPresets as claudeProviderPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import type {
  SharedProviderAppId,
  SharedProviderPreset,
  SharedProviderPresetCategoryId,
  SharedProviderTokenField,
} from "@/shared/providers/domain/types";
import type { ProviderCategory } from "@/types";

type OpenWrtPresetDefinition = {
  id: string;
  label: string;
  baseUrl: string;
  tokenField?: SharedProviderTokenField;
  model?: string;
  description?: string;
  authMode?: string;
};

type SourcePresetLike = {
  name: string;
  category?: ProviderCategory;
  icon?: string;
  iconColor?: string;
  theme?: {
    backgroundColor?: string;
  };
};

const DEFAULT_TOKEN_FIELDS: Record<
  SharedProviderAppId,
  SharedProviderTokenField
> = {
  claude: "ANTHROPIC_AUTH_TOKEN",
  codex: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const SOURCE_PRESETS: Record<SharedProviderAppId, SourcePresetLike[]> = {
  claude: claudeProviderPresets,
  codex: codexProviderPresets,
  gemini: geminiProviderPresets,
};

const RAW_OPENWRT_PROVIDER_PRESETS: Record<
  SharedProviderAppId,
  OpenWrtPresetDefinition[]
> = {
  claude: [
    {
      id: "claude-official",
      label: "Claude Official",
      baseUrl: "https://api.anthropic.com",
      description: "Official Anthropic Claude endpoint. API key is optional — client credentials are forwarded automatically.",
      authMode: "client_passthrough",
    },
    {
      id: "claude-deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      model: "DeepSeek-V3.2",
      description: "DeepSeek Claude-compatible endpoint.",
    },
    {
      id: "claude-zhipu-glm",
      label: "Zhipu GLM",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      model: "glm-5",
    },
    {
      id: "claude-zhipu-glm-en",
      label: "Zhipu GLM en",
      baseUrl: "https://api.z.ai/api/anthropic",
      model: "glm-5",
    },
    {
      id: "claude-bailian",
      label: "Bailian",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    },
    {
      id: "claude-bailian-coding",
      label: "Bailian For Coding",
      baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    },
    {
      id: "claude-kimi",
      label: "Kimi",
      baseUrl: "https://api.moonshot.cn/anthropic",
      model: "kimi-k2.5",
      description: "Moonshot Kimi Claude-compatible endpoint.",
    },
    {
      id: "claude-kimi-coding",
      label: "Kimi For Coding",
      baseUrl: "https://api.kimi.com/coding/",
    },
    {
      id: "claude-modelscope",
      label: "ModelScope",
      baseUrl: "https://api-inference.modelscope.cn",
      model: "ZhipuAI/GLM-5",
    },
    {
      id: "claude-longcat",
      label: "Longcat",
      baseUrl: "https://api.longcat.chat/anthropic",
      model: "LongCat-Flash-Chat",
    },
    {
      id: "claude-minimax",
      label: "MiniMax",
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M2.7",
      description: "MiniMax Claude-compatible endpoint.",
    },
    {
      id: "claude-minimax-en",
      label: "MiniMax en",
      baseUrl: "https://api.minimax.io/anthropic",
      model: "MiniMax-M2.7",
    },
    {
      id: "claude-doubaoseed",
      label: "DouBaoSeed",
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
      model: "doubao-seed-2-0-code-preview-latest",
    },
    {
      id: "claude-bailing",
      label: "BaiLing",
      baseUrl: "https://api.tbox.cn/api/anthropic",
      model: "Ling-2.5-1T",
    },
    {
      id: "claude-aihubmix",
      label: "AiHubMix",
      baseUrl: "https://aihubmix.com",
      tokenField: "ANTHROPIC_API_KEY",
    },
    {
      id: "claude-siliconflow",
      label: "SiliconFlow",
      baseUrl: "https://api.siliconflow.cn",
      model: "Pro/MiniMaxAI/MiniMax-M2.7",
    },
    {
      id: "claude-siliconflow-en",
      label: "SiliconFlow en",
      baseUrl: "https://api.siliconflow.com",
      model: "MiniMaxAI/MiniMax-M2.7",
    },
    {
      id: "claude-dmxapi",
      label: "DMXAPI",
      baseUrl: "https://www.dmxapi.cn",
    },
    {
      id: "claude-packycode",
      label: "PackyCode",
      baseUrl: "https://www.packyapi.com",
    },
    {
      id: "claude-cubence",
      label: "Cubence",
      baseUrl: "https://api.cubence.com",
    },
    {
      id: "claude-aigocode",
      label: "AIGoCode",
      baseUrl: "https://api.aigocode.com",
    },
    {
      id: "claude-rightcode",
      label: "RightCode",
      baseUrl: "https://www.right.codes/claude",
    },
    {
      id: "claude-aicodemirror",
      label: "AICodeMirror",
      baseUrl: "https://api.aicodemirror.com/api/claudecode",
    },
    {
      id: "claude-aicoding",
      label: "AICoding",
      baseUrl: "https://api.aicoding.sh",
    },
    {
      id: "claude-crazyrouter",
      label: "CrazyRouter",
      baseUrl: "https://crazyrouter.com",
    },
    {
      id: "claude-sssaicode",
      label: "SSSAiCode",
      baseUrl: "https://node-hk.sssaicode.com/api",
    },
    {
      id: "claude-compshare",
      label: "Compshare",
      baseUrl: "https://api.modelverse.cn",
    },
    {
      id: "claude-micu",
      label: "Micu",
      baseUrl: "https://www.openclaudecode.cn",
    },
    {
      id: "claude-x-code-api",
      label: "X-Code API",
      baseUrl: "https://x-code.cc",
    },
    {
      id: "claude-ctok",
      label: "CTok.ai",
      baseUrl: "https://api.ctok.ai",
    },
    {
      id: "claude-openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      model: "anthropic/claude-sonnet-4.6",
    },
    {
      id: "claude-novita-ai",
      label: "Novita AI",
      baseUrl: "https://api.novita.ai/anthropic",
      model: "zai-org/glm-5",
    },
    {
      id: "claude-xiaomi-mimo",
      label: "Xiaomi MiMo",
      baseUrl: "https://api.xiaomimimo.com/anthropic",
      model: "mimo-v2-pro",
    },
  ],
  codex: [
    {
      id: "codex-openai-official",
      label: "OpenAI Official",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
      description: "Official OpenAI endpoint. API key is optional — client credentials are forwarded automatically.",
      authMode: "client_passthrough",
    },
    {
      id: "codex-azure-openai",
      label: "Azure OpenAI",
      baseUrl: "https://YOUR_RESOURCE_NAME.openai.azure.com/openai",
      model: "gpt-5.4",
      description:
        "Azure OpenAI Codex endpoint template. Replace YOUR_RESOURCE_NAME before saving.",
    },
    {
      id: "codex-aihubmix",
      label: "AiHubMix",
      baseUrl: "https://aihubmix.com/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-dmxapi",
      label: "DMXAPI",
      baseUrl: "https://www.dmxapi.cn/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-packycode",
      label: "PackyCode",
      baseUrl: "https://www.packyapi.com/v1",
      model: "gpt-5.4",
      description: "PackyCode Codex-compatible endpoint.",
    },
    {
      id: "codex-cubence",
      label: "Cubence",
      baseUrl: "https://api.cubence.com/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-aigocode",
      label: "AIGoCode",
      baseUrl: "https://api.aigocode.com",
      model: "gpt-5.4",
    },
    {
      id: "codex-rightcode",
      label: "RightCode",
      baseUrl: "https://right.codes/codex/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-aicodemirror",
      label: "AICodeMirror",
      baseUrl: "https://api.aicodemirror.com/api/codex/backend-api/codex",
      model: "gpt-5.4",
    },
    {
      id: "codex-aicoding",
      label: "AICoding",
      baseUrl: "https://api.aicoding.sh",
      model: "gpt-5.4",
    },
    {
      id: "codex-crazyrouter",
      label: "CrazyRouter",
      baseUrl: "https://crazyrouter.com/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-sssaicode",
      label: "SSSAiCode",
      baseUrl: "https://node-hk.sssaicode.com/api/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-compshare",
      label: "Compshare",
      baseUrl: "https://api.modelverse.cn/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-micu",
      label: "Micu",
      baseUrl: "https://www.openclaudecode.cn/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-x-code-api",
      label: "X-Code API",
      baseUrl: "https://x-code.cc/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-ctok",
      label: "CTok.ai",
      baseUrl: "https://api.ctok.ai/v1",
      model: "gpt-5.4",
    },
    {
      id: "codex-openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "gpt-5.4",
      description: "OpenRouter Responses-compatible endpoint for Codex.",
    },
  ],
  gemini: [
    {
      id: "gemini-google-official",
      label: "Google Official",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3.1-pro",
      description: "Official Google Gemini API endpoint.",
    },
    {
      id: "gemini-packycode",
      label: "PackyCode",
      baseUrl: "https://www.packyapi.com",
      model: "gemini-3.1-pro",
      description: "PackyCode Gemini-compatible endpoint.",
    },
    {
      id: "gemini-cubence",
      label: "Cubence",
      baseUrl: "https://api.cubence.com",
      model: "gemini-3.1-pro",
    },
    {
      id: "gemini-aigocode",
      label: "AIGoCode",
      baseUrl: "https://api.aigocode.com",
      model: "gemini-3.1-pro",
    },
    {
      id: "gemini-aicodemirror",
      label: "AICodeMirror",
      baseUrl: "https://api.aicodemirror.com/api/gemini",
      model: "gemini-3.1-pro",
    },
    {
      id: "gemini-aicoding",
      label: "AICoding",
      baseUrl: "https://api.aicoding.sh",
      model: "gemini-3.1-pro",
    },
    {
      id: "gemini-crazyrouter",
      label: "CrazyRouter",
      baseUrl: "https://crazyrouter.com",
      model: "gemini-3.1-pro",
    },
    {
      id: "gemini-sssaicode",
      label: "SSSAiCode",
      baseUrl: "https://node-hk.sssaicode.com/api",
      model: "gemini-3.1-pro",
    },
    {
      id: "gemini-ctok",
      label: "CTok.ai",
      baseUrl: "https://api.ctok.ai/v1beta",
      model: "gemini-3.1-pro",
      description: "CTok Gemini-compatible endpoint.",
    },
    {
      id: "gemini-openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      model: "gemini-3.1-pro",
      description: "OpenRouter Gemini-compatible endpoint.",
    },
  ],
};

function resolveSharedCategory(
  definition: OpenWrtPresetDefinition,
  sourcePreset?: SourcePresetLike,
): SharedProviderPresetCategoryId {
  const category = sourcePreset?.category;

  if (
    category === "official" ||
    category === "cn_official" ||
    category === "cloud_provider" ||
    category === "aggregator" ||
    category === "third_party"
  ) {
    return category;
  }

  return definition.id.includes("official") ? "official" : "third_party";
}

function findSourcePreset(
  appId: SharedProviderAppId,
  definition: OpenWrtPresetDefinition,
): SourcePresetLike | undefined {
  return SOURCE_PRESETS[appId].find(
    (preset) => preset.name === definition.label,
  );
}

function buildOpenWrtPreset(
  appId: SharedProviderAppId,
  definition: OpenWrtPresetDefinition,
): SharedProviderPreset {
  const sourcePreset = findSourcePreset(appId, definition);

  return {
    id: definition.id,
    appId,
    label: definition.label,
    providerName: definition.label,
    baseUrl: definition.baseUrl,
    tokenField: definition.tokenField ?? DEFAULT_TOKEN_FIELDS[appId],
    model: definition.model ?? "",
    description: definition.description ?? "",
    sourcePresetName: definition.label,
    category: resolveSharedCategory(definition, sourcePreset),
    icon: sourcePreset?.icon,
    iconColor: sourcePreset?.iconColor,
    accentColor: sourcePreset?.theme?.backgroundColor,
    authMode: definition.authMode,
    supportedOn: {
      desktop: true,
      openwrt: true,
    },
  };
}

export const OPENWRT_SHARED_PROVIDER_PRESET_CATALOG: Record<
  SharedProviderAppId,
  SharedProviderPreset[]
> = {
  claude: RAW_OPENWRT_PROVIDER_PRESETS.claude.map((definition) =>
    buildOpenWrtPreset("claude", definition),
  ),
  codex: RAW_OPENWRT_PROVIDER_PRESETS.codex.map((definition) =>
    buildOpenWrtPreset("codex", definition),
  ),
  gemini: RAW_OPENWRT_PROVIDER_PRESETS.gemini.map((definition) =>
    buildOpenWrtPreset("gemini", definition),
  ),
};
