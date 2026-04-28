import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Search, Star } from "lucide-react";
import type { SharedProviderPreset } from "@/shared/providers/domain";
import {
  getCustomPresetUiMeta,
  getPresetUiMeta,
  PRESET_UI_TAG_LABELS,
  type PresetUiMeta,
  type PresetUiTag,
} from "../presetCategoryMap";
import { OpenWrtProviderIcon } from "../providerIcons";

export type ProviderSidePanelPresetGroup = {
  id: "official" | "platform" | "compatible";
  label: string;
  hint: string;
  presets: SharedProviderPreset[];
};

interface ProviderSidePanelPresetTabProps {
  groups: ProviderSidePanelPresetGroup[];
  selectedPresetId: string | null;
  onPresetSelect: (presetId: string) => void;
  onCancel?: () => void;
}

type PresetFilterId = Exclude<PresetUiTag, "partner"> | "all";

type PresetCardModel = {
  appId: SharedProviderPreset["appId"];
  id: string;
  title: string;
  description: string;
  meta: string;
  source?: Pick<
    SharedProviderPreset,
    "baseUrl" | "icon" | "iconColor" | "tokenField"
  >;
  uiMeta: PresetUiMeta;
  searchText: string;
};

const PRESET_FILTERS: Array<{ id: PresetFilterId; label: string }> = [
  { id: "official", label: "Official" },
  { id: "open_source", label: "Open-source" },
  { id: "aggregator", label: "Aggregator" },
  { id: "third_party", label: "Third Party" },
  { id: "universal", label: "Universal" },
  { id: "custom", label: "Custom" },
  { id: "all", label: "All" },
];
const DEFAULT_PRESET_FILTER_ID: PresetFilterId = PRESET_FILTERS[0]?.id ?? "all";

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function getTagLabel(tag: PresetUiTag): string {
  return PRESET_UI_TAG_LABELS[tag];
}

function joinSearchParts(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

function buildSearchText(preset: SharedProviderPreset, uiMeta: PresetUiMeta) {
  return joinSearchParts([
    preset.providerName,
    preset.label,
    preset.baseUrl,
    preset.description,
    preset.model,
    preset.sourcePresetName,
    ...uiMeta.badges.map((badge) => badge.label),
    ...uiMeta.tags.map(getTagLabel),
  ]);
}

function buildCustomSearchText(uiMeta: PresetUiMeta) {
  return joinSearchParts([
    "Custom Configuration",
    "Manually fill all necessary fields",
    "Manual endpoint and token configuration",
    ...uiMeta.badges.map((badge) => badge.label),
    ...uiMeta.tags.map(getTagLabel),
  ]);
}

function getGridColumnCount(elements: HTMLElement[]): number {
  if (elements.length <= 1) {
    return 1;
  }

  const hasLayout = elements.some((element) => {
    const rect = element.getBoundingClientRect();
    return Boolean(rect.width || rect.height || rect.top || rect.left);
  });

  if (!hasLayout) {
    return Math.min(3, elements.length);
  }

  const firstTop = elements[0]?.getBoundingClientRect().top ?? 0;
  const measuredColumns = elements.filter((element) => {
    const top = element.getBoundingClientRect().top;
    return Math.abs(top - firstTop) < 2;
  }).length;

  return Math.max(1, measuredColumns || Math.min(3, elements.length));
}

function PresetCard({
  card,
  cardIndex,
  selected,
  onStage,
  onKeyDown,
  setCardRef,
}: {
  card: PresetCardModel;
  cardIndex: number;
  selected: boolean;
  onStage: (presetId: string) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    cardIndex: number,
    presetId: string,
  ) => void;
  setCardRef: (index: number, element: HTMLButtonElement | null) => void;
}) {
  const descriptionId = `owt-preset-${card.id}-description`;
  const metaId = `owt-preset-${card.id}-meta`;
  const showPartnerFeature = card.uiMeta.variant === "partner" && !selected;

  return (
    <button
      type="button"
      className="owt-provider-panel__preset-card"
      data-selected={selected ? "true" : "false"}
      data-variant={card.uiMeta.variant}
      role="radio"
      aria-checked={selected}
      aria-describedby={`${descriptionId} ${metaId}`}
      onClick={() => onStage(card.id)}
      onKeyDown={(event) => onKeyDown(event, cardIndex, card.id)}
      ref={(element) => setCardRef(cardIndex, element)}
    >
      <span
        className="owt-provider-panel__provider-mark owt-provider-panel__preset-icon"
        data-tone={card.uiMeta.tone}
        aria-hidden="true"
      >
        {card.id === "custom" ? (
          <Plus className="h-4 w-4" aria-hidden="true" />
        ) : (
          <OpenWrtProviderIcon
            appId={card.appId}
            name={card.title}
            size={20}
            source={card.source}
          />
        )}
      </span>
      <span className="owt-provider-panel__preset-copy">
        <span className="owt-provider-panel__preset-title">{card.title}</span>
        <span
          className="owt-provider-panel__preset-description"
          id={descriptionId}
        >
          {card.description}
        </span>
        <span className="owt-provider-panel__preset-meta" id={metaId}>
          {card.meta}
        </span>
      </span>
      {selected ? (
        <Check
          className="owt-provider-panel__preset-feature-icon"
          aria-hidden="true"
        />
      ) : null}
      {showPartnerFeature ? (
        <Star
          className="owt-provider-panel__preset-feature-icon"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

export function ProviderSidePanelPresetTab({
  groups,
  selectedPresetId,
  onPresetSelect,
  onCancel = () => {},
}: ProviderSidePanelPresetTabProps) {
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(
    selectedPresetId,
  );
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<PresetFilterId>(
    DEFAULT_PRESET_FILTER_ID,
  );
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setPendingPresetId(selectedPresetId);
  }, [selectedPresetId]);

  const cards = useMemo<PresetCardModel[]>(() => {
    const firstPreset = groups[0]?.presets[0];
    const customUiMeta = getCustomPresetUiMeta();
    const customCard: PresetCardModel = {
      appId: firstPreset?.appId ?? "claude",
      id: "custom",
      title: "Custom Configuration",
      description: "Manually fill all necessary fields.",
      meta: "Manual endpoint and token configuration",
      uiMeta: customUiMeta,
      searchText: buildCustomSearchText(customUiMeta),
    };

    const presetCards = groups.flatMap((group) =>
      group.presets.map((preset) => {
        const uiMeta = getPresetUiMeta(preset);
        const meta = preset.model
          ? `${preset.baseUrl} · ${preset.model}`
          : preset.baseUrl;

        return {
          appId: preset.appId,
          id: preset.id,
          title: preset.providerName,
          description: preset.description || "No extra notes provided.",
          meta,
          source: preset,
          uiMeta,
          searchText: buildSearchText(preset, uiMeta),
        };
      }),
    );

    return [customCard, ...presetCards];
  }, [groups]);

  const normalizedSearch = normalizeSearchValue(search);
  const visibleCards = cards.filter((card) => {
    const matchesFilter =
      activeFilter === "all" || card.uiMeta.tags.includes(activeFilter);
    const matchesSearch =
      normalizedSearch.length === 0 ||
      card.searchText.includes(normalizedSearch);

    return matchesFilter && matchesSearch;
  });
  const stagedCard = cards.find((card) => card.id === pendingPresetId) ?? null;
  const footerCopy = stagedCard
    ? `${stagedCard.title} · ${stagedCard.meta}`
    : "No preset selected · Choose a preset or Custom Configuration to continue";
  const emptyCopy = search.trim()
    ? `No presets match “${search.trim()}”.`
    : "No presets match the current filters.";

  useEffect(() => {
    cardRefs.current = cardRefs.current.slice(0, visibleCards.length);
  }, [visibleCards.length]);

  function setFilterRef(index: number, element: HTMLButtonElement | null) {
    filterRefs.current[index] = element;
  }

  function setCardRef(index: number, element: HTMLButtonElement | null) {
    cardRefs.current[index] = element;
  }

  function selectFilter(index: number) {
    const filter = PRESET_FILTERS[index];

    if (!filter) {
      return;
    }

    setActiveFilter(filter.id);
    filterRefs.current[index]?.focus();
  }

  function handleFilterKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();

    if (event.key === "Home") {
      selectFilter(0);
      return;
    }

    if (event.key === "End") {
      selectFilter(PRESET_FILTERS.length - 1);
      return;
    }

    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex =
      (index + delta + PRESET_FILTERS.length) % PRESET_FILTERS.length;
    selectFilter(nextIndex);
  }

  function handleCardKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    cardIndex: number,
    presetId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setPendingPresetId(presetId);
      return;
    }

    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();

    const elements = cardRefs.current.filter(
      (element): element is HTMLButtonElement => Boolean(element),
    );
    const columns = getGridColumnCount(elements);
    let nextIndex = cardIndex;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = elements.length - 1;
    } else if (event.key === "ArrowLeft") {
      nextIndex = Math.max(0, cardIndex - 1);
    } else if (event.key === "ArrowRight") {
      nextIndex = Math.min(elements.length - 1, cardIndex + 1);
    } else if (event.key === "ArrowUp") {
      nextIndex = Math.max(0, cardIndex - columns);
    } else if (event.key === "ArrowDown") {
      nextIndex = Math.min(elements.length - 1, cardIndex + columns);
    }

    elements[nextIndex]?.focus();
  }

  return (
    <div className="owt-provider-panel__tab-stack owt-provider-panel__preset-picker">
      <header className="owt-provider-panel__detail-head owt-provider-panel__preset-picker-head">
        <div className="owt-provider-panel__detail-copy">
          <h2 className="owt-provider-panel__detail-title">Provider Preset</h2>
          <p className="owt-provider-panel__subtitle">
            Choose a preset, then continue editing the fields below.
          </p>
        </div>
        <label className="owt-provider-panel__search owt-provider-panel__preset-search">
          <Search className="h-4 w-4" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search presets"
            placeholder="Search presets, provider, or URL"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </header>

      <div
        className="owt-provider-panel__preset-filters"
        role="radiogroup"
        aria-label="Preset category filter"
      >
        {PRESET_FILTERS.map((filter, index) => {
          const active = filter.id === activeFilter;

          return (
            <button
              className="owt-activity-drawer__filter-button"
              data-active={active ? "true" : "false"}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              key={filter.id}
              onClick={() => selectFilter(index)}
              onKeyDown={(event) => handleFilterKeyDown(event, index)}
              ref={(element) => setFilterRef(index, element)}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {visibleCards.length === 0 ? (
        <div className="owt-provider-panel__empty" role="status">
          {emptyCopy}
        </div>
      ) : (
        <div
          className="owt-provider-panel__preset-grid"
          role="radiogroup"
          aria-label="Provider presets"
        >
          {visibleCards.map((card, index) => (
            <PresetCard
              card={card}
              cardIndex={index}
              key={card.id}
              selected={pendingPresetId === card.id}
              onStage={setPendingPresetId}
              onKeyDown={handleCardKeyDown}
              setCardRef={setCardRef}
            />
          ))}
        </div>
      )}

      <footer className="owt-provider-panel__config-actions owt-provider-panel__preset-actions-row">
        <span className="owt-provider-panel__config-footer-copy">
          {footerCopy}
        </span>
        <div className="owt-provider-panel__config-footer-actions">
          <button
            type="button"
            className="owt-provider-panel__button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="owt-provider-panel__button owt-provider-panel__button--primary"
            disabled={!pendingPresetId}
            onClick={() => {
              if (pendingPresetId) {
                onPresetSelect(pendingPresetId);
              }
            }}
          >
            Select preset
          </button>
        </div>
      </footer>
    </div>
  );
}
