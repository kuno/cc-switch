import {
  getSharedProviderPresetById,
  inferSharedProviderPresetId,
  type SharedProviderAppId,
  type SharedProviderView,
} from "../domain";
import { getSharedProviderDisplayName } from "./presentation";

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

export function getSharedProviderSearchTokens(
  appId: SharedProviderAppId,
  provider: SharedProviderView,
): string[] {
  const presetId = inferSharedProviderPresetId(appId, provider);
  const preset =
    presetId === "custom" ? null : getSharedProviderPresetById(appId, presetId);

  return [
    getSharedProviderDisplayName(provider),
    provider.providerId ?? "",
    provider.baseUrl,
    provider.model,
    provider.notes,
    provider.tokenField,
    preset?.label ?? "",
    preset?.providerName ?? "",
    preset?.sourcePresetName ?? "",
  ];
}

export function matchesSharedProviderSearch(
  appId: SharedProviderAppId,
  provider: SharedProviderView,
  searchQuery: string,
): boolean {
  const normalizedQuery = normalizeSearchValue(searchQuery);

  if (!normalizedQuery) {
    return true;
  }

  return getSharedProviderSearchTokens(appId, provider).some((token) =>
    normalizeSearchValue(token).includes(normalizedQuery),
  );
}

export function filterSharedProviders(
  appId: SharedProviderAppId,
  providers: SharedProviderView[],
  searchQuery: string,
): SharedProviderView[] {
  return providers.filter((provider) =>
    matchesSharedProviderSearch(appId, provider, searchQuery),
  );
}

export function getSharedProviderSearchSummary(
  searchQuery: string,
  visibleCount: number,
  totalCount: number,
): string | null {
  const normalizedQuery = normalizeSearchValue(searchQuery);

  if (!normalizedQuery) {
    return null;
  }

  const resultLabel = visibleCount === 1 ? "result" : "results";

  if (visibleCount === totalCount) {
    return `${visibleCount} ${resultLabel} for "${searchQuery.trim()}".`;
  }

  return `${visibleCount} of ${totalCount} providers match "${searchQuery.trim()}".`;
}
