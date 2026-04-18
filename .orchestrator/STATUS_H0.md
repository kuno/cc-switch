# STATUS_H0

## Scope landed

H0 delivers the OpenWrt LuCI regression test foundation only:

- Playwright visual regression config at `playwright.config.ts`
- Standalone Vite visual harness under `tests/openwrt/visual/harness/`
- One Playwright smoke spec for `AlertStrip`
- One RTL smoke spec for `AlertStrip`
- Component-test bridge fixture at `tests/openwrt/component/fixtures/bridge.ts`
- PR-only GitHub Actions workflow at `.github/workflows/openwrt-ui-regression.yml`

No `src/openwrt-provider-ui/` production code changed.
No LuCI shim or RPC backend files changed.
The `OpenWrtSharedPageShellApi` type is already exported from
`src/openwrt-provider-ui/pageTypes.ts`, so H0 did not need a production seam.

## Harness choice

Choice: Option A, standalone Vite harness.

Why:

- Lower overhead than Storybook for six parallel component waves
- Deterministic single-component rendering with stable URL params
- Easy to build and preview inside Playwright `webServer`
- Easy for H1-H6 to extend by adding one entry per component state

## Harness URL schema

Use:

`/?component=<ComponentName>&state=<stateName>&theme=<light|dark>`

Current smoke example:

`/?component=AlertStrip&state=stopped&theme=light`

Implementation notes:

- URL parsing lives in `tests/openwrt/visual/harness/entries.tsx`
- Theme is applied with the same OpenWrt body classes used by the page shell
- Baseline snapshots are stored at
  `tests/openwrt/visual/__snapshots__/<project>/<spec-file>/`

## How H1-H6 should add coverage

For each new component/state:

1. Add a case in `tests/openwrt/visual/harness/entries.tsx`.
2. Add a Playwright spec at `tests/openwrt/visual/<component>.spec.ts`.
3. Add an RTL spec at `tests/openwrt/component/<component>.test.tsx`.

Follow the H0 examples:

- RTL example: `tests/openwrt/component/__example__.test.tsx`
- Visual example: `tests/openwrt/visual/alert-strip.spec.ts`

Use the bridge fixture from:

- `tests/openwrt/component/fixtures/bridge.ts`

That fixture stubs the complete real `OpenWrtSharedPageShellApi` surface and is
safe to override method-by-method in component tests.

## Local commands

Install:

- `pnpm install --frozen-lockfile`

Component tests:

- `pnpm test:component`
- `pnpm test:component:watch`

Visual tests:

- `pnpm test:visual`
- `pnpm test:visual:update`
- `pnpm test:visual:update:linux`

Builds and existing OpenWrt contract:

- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`

Harness-only utilities:

- `pnpm build:openwrt-visual-harness`
- `pnpm preview:openwrt-visual-harness`

## CI workflow

Workflow file:

- `.github/workflows/openwrt-ui-regression.yml`

Trigger:

- `pull_request` against `openwrt-proxy` only

Jobs:

- `typecheck`
- `unit` running `pnpm test:component`
- `bundle` running `pnpm build:openwrt-provider-ui`
- `visual` running Playwright on Chromium and uploading report artifacts
- `bundle-contract` running `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`

## Known limitations and notes

- Playwright is configured for Chromium only. Keep new visual specs Chromium-safe.
- All committed baselines must be Linux-rendered via:
  `docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm test:visual:update'`
- `pnpm test:visual:update:linux` wraps that Docker command and is the preferred
  refresh path before committing snapshot PNGs.
- macOS local `pnpm test:visual` may show diffs against the committed Linux
  baselines. That is expected.
- macOS local `pnpm test:visual:update` is for temporary iteration only. Do not
  commit PNGs produced by that command; always regenerate Linux baselines before
  committing.
- `actionlint` was not available in this environment, and `gh workflow view`
  cannot validate an unpublished workflow file from the remote default branch.
  H0 validated YAML syntax locally with Ruby's `YAML.load_file`.
- Local runs emit `baseline-browser-mapping` staleness warnings from upstream
  tooling. They do not fail the suite.
- Local runs also emit a benign `--localstorage-file` warning from the current
  toolchain.

## Verification completed

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- `pnpm build:openwrt-visual-harness`
- `pnpm test:visual:update:linux`
- `docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm test:visual'`
- Ruby YAML parse of `.github/workflows/openwrt-ui-regression.yml`
