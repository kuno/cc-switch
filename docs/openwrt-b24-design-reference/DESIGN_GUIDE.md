# CC Switch OpenWrt B2.4 Design Guide

## Purpose

This guide documents the current visual system used by the B2.4 mock so future designers can extend it without drifting into a different product language.

The goal is not “more styling.” The goal is a cleaner OpenWrt control surface that feels closer to a lightweight native desktop utility: calm, sharp hierarchy, restrained accent use, low copy density, and obvious edit affordances.

## Visual Thesis

Soft translucent shell, dense utility content, and desktop-like control polish.

The design should feel:

- operational, not marketing-heavy
- premium, but quiet
- modern, but not ornamental
- lighter and more breathable than stock LuCI without becoming decorative SaaS chrome

## Content Plan

The current B2.4 screen is structured into three functional layers:

1. Page identity
2. Daemon control band
3. Provider workspace

This hierarchy should stay intact unless the product model changes.

### 1. Page Identity

Purpose:

- orient the user inside LuCI
- make `CC Switch` the dominant page label
- keep everything else secondary

Rules:

- `OpenWrt / Services` is support text
- `CC Switch` is the loudest text on the page
- subtitle copy should be omitted unless it adds operational value

### 2. Daemon Control Band

Purpose:

- expose current service state
- expose primary actions
- expose core daemon configuration close to those actions

Rules:

- status and actions stay in the top row
- detail fields sit below a divider
- the band reads like one continuous control surface, not a cluster of nested cards

### 3. Provider Workspace

Purpose:

- browse providers on the left
- inspect and edit one provider on the right

Rules:

- left column is a navigation/filter rail
- right column is the editing surface
- tabs and segmented controls should reduce complexity, not add decoration

## Layout System

### Outer Shell

- max width: `1600px`
- page padding: `28px`
- large panels use `--radius-panel`

The shell should feel wide and desktop-native. Avoid compressing the layout into a narrow center column.

### Panel Hierarchy

Use these tiers consistently:

- page background: atmospheric only
- primary panel: major workspace containers
- internal card: only when it groups a specific interaction or data cluster
- controls: inputs, chips, pills, segmented items

Do not add extra card layers if layout and spacing already communicate grouping.

### Spacing Rhythm

Current spacing is based on a restrained desktop rhythm:

- page-level gaps: `20px` to `24px`
- internal panel padding: `22px` to `24px`
- control-group gaps: `10px` to `16px`
- dense field-grid spacing: `12px` to `16px`

When in doubt, remove elements before reducing spacing too far.

## Color System

### Core Tokens

Light theme:

- background: `#eef3f8`
- primary panel: `rgba(255, 255, 255, 0.86)`
- strong panel: `#ffffff`
- soft panel: `#f8fbff`
- line: `#d8e2ef`
- strong line: `#ccd7e6`
- text: `#172133`
- muted text: `#708198`
- soft text: `#90a0b4`
- accent: `#4d7cff`
- accent soft: `#ebf2ff`
- accent text: `#2752c9`
- success: `#2d8a5a`
- success soft: `#edf8f1`
- success line: `#bfe4cd`

Dark theme:

- background: `#0f141b`
- primary panel: `rgba(20, 28, 38, 0.92)`
- strong panel: `#151d27`
- soft panel: `#121923`
- line: `#263241`
- strong line: `#314258`
- text: `#eef4fb`
- muted text: `#93a2b8`
- soft text: `#6e7d92`
- accent: `#7f94ff`
- accent soft: `#212d48`
- accent text: `#dfe5ff`

### Color Rules

- use one primary accent blue for action and active state
- reserve green for positive status only
- avoid introducing additional semantic colors without a product reason
- dark theme should preserve hierarchy through surface contrast, not neon accents

## Typography

Current stack:

- `"SF Pro Display", Inter, ui-sans-serif, system-ui, sans-serif`

Usage:

- page title: large, heavy, tight tracking
- section title: medium, bold, compact
- labels: small uppercase with generous letter spacing
- support text: muted, medium weight
- field values: clear and practical, not oversized

Typography rules:

- the product name is the strongest typographic event
- avoid multiple “headline moments” in one screen
- utility labels should be quieter than actionable values
- keep descriptive copy minimal

## Radius System

Keep radius usage token-based and consistent:

- `--radius-panel: 28px`
- `--radius-card: 20px`
- `--radius-control: 16px`
- `--radius-icon: 12px`

Usage:

- outer panels and workspaces: panel radius
- grouped inner surfaces: card radius
- inputs, dropdowns, chips, and buttons: control radius or pill radius
- icon shells: icon radius

Do not manually introduce one-off corner values unless a new component family is being defined.

## Divider Rules

Dividers are structural, not decorative.

Rules:

- use the shared divider color token
- keep divider weight subtle
- align divider start/end with the content they separate
- remove a divider if spacing already communicates the break

Common mistake to avoid:

- adding inset dividers inside containers that already have horizontal padding, causing visual misalignment

## Surface and Shadow Rules

Panels use:

- soft translucency
- thin border
- restrained shadow

The system should still feel premium if shadows are reduced. If a component only works because of a heavy shadow, the hierarchy is weak.

## Component Guidance

### Pills and Chips

Use for:

- state
- lightweight segmented controls
- compact filters

Avoid using pills for long copy or dense navigation.

### Buttons

Primary button:

- reserved for save/add/apply actions
- blue fill
- white text

Secondary button:

- pale surface
- thin border
- dark text

Destructive button:

- only when a destructive action exists in the actual product

### Inputs

Inputs must look editable.

Rules:

- real editable fields should use form controls, not static text boxes
- placeholder or read-only content should be visually distinct from editable state
- field labels remain small and uppercase

### Provider Rows

Provider list rows should be optimized for scanning:

- logo/icon first
- provider name second
- URL or endpoint support text third
- state badge last

The row should remain legible even if support text is shortened.

### Tabs and Segmented Controls

Use tabs only when they change the current working context.

Use segmented controls only when the choices are siblings of equal weight.

Do not stack multiple competing tab systems close together unless each layer clearly controls a different scope.

## Editable vs Placeholder-Only

This is critical in OpenWrt/LuCI design work.

### Editable

The UI should visually imply editability only when the prototype actually represents an editable field or a plausible real form control.

### Placeholder-Only

Any control that depends on missing backend or RPC support must be clearly treated as placeholder-only in design notes and handoff.

Examples:

- experimental provider routing behaviors without confirmed support
- speculative save modes
- advanced daemon options not represented in current runtime data

Avoid silently presenting unsupported behavior as finished product semantics.

## Interaction Thesis

The current design direction should keep motion restrained and desktop-like.

Recommended motion set:

1. Surface fade and slight rise on first render
2. Dropdown and menu reveal with short vertical motion and opacity
3. Theme transition through color interpolation, not dramatic animation

Motion rules:

- duration range: roughly `140ms` to `220ms`
- easing: calm and slightly eased-out
- no bouncing
- no ornamental looping animations
- interactive motion should improve clarity, not spectacle

## Recommended Animation Treatments

### Panel Entrance

- opacity from `0` to `1`
- translate Y from `8px` to `0`
- duration about `180ms`

### Dropdown Reveal

- opacity from `0` to `1`
- translate Y from `6px` to `0`
- duration about `160ms`

### Hover State

- subtle border-color shift
- subtle background shift
- avoid scale-up on dense controls

## Hand-Edit Maintenance Notes

For future manual edits:

- keep shared tokens near the top of the file
- avoid repeating hard-coded colors throughout the document
- keep component sections clearly labeled
- prefer one class per component role over many one-off utility rules
- when removing visual blocks, check for runtime JS references before deleting DOM nodes

## Drift To Avoid

Avoid these common failure modes:

- reintroducing copy-heavy subtitles everywhere
- replacing editable inputs with decorative static boxes
- adding more accent colors
- using inconsistent corner radii
- over-carding the workspace
- using full-bleed dividers that do not align with surrounding content

## Designer Checklist

Before considering a change complete, verify:

- the product name is still the strongest text
- editable things still look editable
- placeholder-only interactions are labeled in handoff notes
- card count has not grown without reason
- divider alignment matches nearby content
- the same component type still uses the same radius and border treatment
- dark theme still has clear surface hierarchy
