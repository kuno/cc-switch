import { ProviderIcon } from "@/components/ProviderIcon";
import { hasIcon } from "@/icons/extracted";
import {
  getSharedProviderPresetById,
  inferSharedProviderPresetId,
  type SharedProviderAppId,
  type SharedProviderPreset,
  type SharedProviderTokenField,
  type SharedProviderView,
} from "@/shared/providers/domain";

declare const __OPENWRT_PROVIDER_UI_ICON_BASE_URL__: string;

export const OPENWRT_PROVIDER_UI_ICON_BASE_URL =
  typeof __OPENWRT_PROVIDER_UI_ICON_BASE_URL__ === "string"
    ? __OPENWRT_PROVIDER_UI_ICON_BASE_URL__
    : "/luci-static/resources/ccswitch/provider-ui/icons";

const APP_ICON_FILENAMES: Record<
  SharedProviderAppId | "opencode" | "openclaw",
  string
> = {
  claude: "claude.svg",
  codex: "openai.svg",
  gemini: "gemini.svg",
  opencode: "opencode.svg",
  openclaw: "openclaw.svg",
};

const DEFAULT_PROVIDER_ICON_BY_APP: Record<SharedProviderAppId, string> = {
  claude: "anthropic",
  codex: "openai",
  gemini: "gemini",
};

type OpenWrtProviderIconSource = Partial<
  Pick<
    SharedProviderView | SharedProviderPreset,
    "baseUrl" | "icon" | "iconColor" | "tokenField"
  >
>;

function trimOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function createResolvedIcon(
  icon: string | undefined,
  color: string | undefined,
): {
  color?: string;
  icon: string;
} | null {
  const normalizedIcon = trimOptionalValue(icon);

  if (!normalizedIcon || !hasIcon(normalizedIcon)) {
    return null;
  }

  return {
    icon: normalizedIcon,
    color: trimOptionalValue(color),
  };
}

export function getOpenWrtAppIconUrl(
  appId: keyof typeof APP_ICON_FILENAMES,
): string {
  return `${OPENWRT_PROVIDER_UI_ICON_BASE_URL}/${APP_ICON_FILENAMES[appId]}`;
}

export function resolveOpenWrtProviderIcon(
  appId: SharedProviderAppId,
  source: OpenWrtProviderIconSource | null | undefined,
): {
  color?: string;
  icon: string;
} | null {
  const persistedIcon = createResolvedIcon(source?.icon, source?.iconColor);
  const presetId = inferSharedProviderPresetId(appId, {
    baseUrl: source?.baseUrl ?? "",
    tokenField: source?.tokenField as SharedProviderTokenField | undefined,
  });
  const preset =
    presetId === "custom" ? null : getSharedProviderPresetById(appId, presetId);
  const presetIcon = createResolvedIcon(preset?.icon, preset?.iconColor);

  if (
    presetIcon &&
    (!persistedIcon ||
      persistedIcon.icon === DEFAULT_PROVIDER_ICON_BY_APP[appId])
  ) {
    return presetIcon;
  }

  return persistedIcon;
}

export function OpenWrtProviderIcon({
  appId,
  className,
  name,
  size,
  source,
}: {
  appId: SharedProviderAppId;
  className?: string;
  name: string;
  size: number | string;
  source: OpenWrtProviderIconSource | null | undefined;
}) {
  const resolvedIcon = resolveOpenWrtProviderIcon(appId, source);

  if (resolvedIcon) {
    return (
      <ProviderIcon
        className={className}
        color={resolvedIcon.color}
        icon={resolvedIcon.icon}
        name={name}
        showFallback={false}
        size={size}
      />
    );
  }

  const sizeValue = typeof size === "number" ? `${size}px` : size;

  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      loading="lazy"
      src={getOpenWrtAppIconUrl(appId)}
      style={{
        width: sizeValue,
        height: sizeValue,
      }}
    />
  );
}
