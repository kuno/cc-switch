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

export const OPENWRT_PROVIDER_UI_ICON_BASE_URL =
  "/luci-static/resources/ccswitch/provider-ui/icons";

const APP_ICON_FILENAMES: Record<SharedProviderAppId, string> = {
  claude: "claude.svg",
  codex: "openai.svg",
  gemini: "gemini.svg",
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

export function getOpenWrtAppIconUrl(appId: SharedProviderAppId): string {
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

  if (persistedIcon) {
    return persistedIcon;
  }

  const presetId = inferSharedProviderPresetId(appId, {
    baseUrl: source?.baseUrl ?? "",
    tokenField: source?.tokenField as SharedProviderTokenField | undefined,
  });

  if (presetId === "custom") {
    return null;
  }

  const preset = getSharedProviderPresetById(appId, presetId);
  return createResolvedIcon(preset?.icon, preset?.iconColor);
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
