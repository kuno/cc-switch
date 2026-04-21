# CC Switch OpenWrt UI — revised layout drop

Five files. Drop them onto the `openwrt-proxy` branch, commit, push.

## What this changes

Aligns the React implementation with `revised/index.html`:

- **`OpenWrtPageShell.tsx`** — drops the giant `OpenWrt / Services` breadcrumb and `CC Switch` hero title; introduces `<SectionHead>` with an inline version chip; moves the theme toggle into the Apps section head; reorders the page to `alert → Apps head → apps → Daemon head → daemon`.
- **`AppsGrid.tsx`** — splits cards into **Configured** and **Not configured** groups; renders the "Not configured" group header; fills the odd slot of each group with a skeleton placeholder so the 2-col grid stays balanced.
- **`DaemonCard.tsx`** — single-row top bar (`Running · Healthy · log-level select · spacer · Restart · Save`); drops the eyebrow, the redundant "Healthy" wording hint, and the old intro block; moves the version chip out to the Daemon section head; uses the flat 4-column field grid below a thin divider.
- **`AppCard.tsx`** — (already shipped in an earlier commit, re-included here so the drop is self-contained) status chip is the activity-drawer trigger, Tokens/Requests/Cost row replaces the recent-activity footer, dashed-border empty-state with CTA for the unconfigured variant.
- **`openwrt-provider-ui.patch.css`** — additive rules for the new classes the four TSX files reference (section head, group grid, daemon row + field grid, pills, chip-select, theme toggle, entrance animation). Designed to sit **below** the existing `openwrt-provider-ui.css` — nothing is rewritten.

## Where to put them

```
src/openwrt-provider-ui/
  OpenWrtPageShell.tsx          ← replace
  openwrt-provider-ui.css       ← append contents of openwrt-provider-ui.patch.css
  components/
    AppsGrid.tsx                ← replace
    DaemonCard.tsx              ← replace
    AppCard.tsx                 ← replace
```

## CSS application

Either:

1. **Append** (simplest): paste the contents of `openwrt-provider-ui.patch.css` at the bottom of `openwrt-provider-ui.css`.
2. **Import**: keep it as a separate file and `@import "./openwrt-provider-ui.patch.css";` after the main stylesheet.

The patch only *adds* rules; it does not redefine existing selectors, except for a scoped
override on `.owt-daemon-row .owt-daemon-status` (needed — the revised design uses a large
typographic status in the row instead of the old chip pill; the override is narrowed by
the `.owt-daemon-row` ancestor so other uses of `.owt-daemon-status` are unaffected).

## Tokens

The patch falls back cleanly when these tokens are not yet in the stylesheet:
`--panel-softer`, `--button`, `--mono`, `--soft`, `--fail`, `--fail-soft`, `--fail-line`.
If you decide to promote them to real CSS variables later, delete the fallback block at
the top of the patch file.

## Version chips

Currently hard-coded in `OpenWrtPageShell.tsx` as `LUCI_APP_VERSION = "v0.2.4"` and a
fallback `DAEMON_FALLBACK_VERSION = "v0.4.2"` (the live daemon version from
`host.version` wins when present). Swap `LUCI_APP_VERSION` for a real package-version
source when one is wired up.

## Not in this drop

- The `<AlertStrip>` component — unchanged; still renders above the Apps section.
- Activity drawer, side panel, provider panel — unchanged.
- `DESIGN_GUIDE.md` — unchanged.
- Anything in `review/` (those are design screenshots, not source).
