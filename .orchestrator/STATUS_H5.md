# STATUS_H5

## Scope landed

Expanded `AlertStrip` regression coverage without touching production files under
`src/openwrt-provider-ui/`.

Added and updated:

- `tests/openwrt/visual/alert-strip.spec.ts`
- `tests/openwrt/visual/harness/entries.tsx`
- `tests/openwrt/visual/harness/styles.css`
- `tests/openwrt/component/alert-strip.test.tsx`
- `tests/openwrt/component/alert-strip.hardrules.test.tsx`
- Linux snapshots under
  `tests/openwrt/visual/__snapshots__/openwrt-{light,dark}/alert-strip.spec.ts/`

## States covered

Visual coverage:

- Healthy / hidden: no `.owt-alert-strip` rendered, asserted without snapshots
- Stopped
- Unreachable (`host.health === "degraded"`)
- Restarting (`restartInFlight === true`)
- Restart failed
- Restart failed with long wrapping detail

RTL coverage:

- Healthy daemon renders `null`
- Stopped copy and restart control
- Unreachable copy with endpoint and proxy detail
- Restart click fires the wired handler exactly once
- Restarting state announces busy/pending UI
- Restart failure renders alert semantics and retry control
- Restart failure after an in-flight restart settles with an error
- Hard-rule forbidden text/class assertions across all visible variants

## ARIA and keyboard findings

- `stopped`, `unreachable`, and `restarting` render `role="status"` with
  `aria-live="polite"`.
- `restart-failed` renders `role="alert"` with `aria-live="assertive"`.
- `aria-busy` mirrors `restartInFlight`.
- Keyboard activation works on the native action button for both
  `Restart now` and `Retry restart` with Enter and Space.

## Seam flags

- `AlertStrip` does not implement a generic visible informational-message state.
  Non-error `message` values do not create a new alert-strip variant.
- While `restartInFlight`, the component removes the action button entirely
  instead of showing a disabled button. Tests assert the actual source behavior:
  busy semantics plus spinner, with no action control present.
- In this environment, `pnpm test:visual:update:linux` fails before Playwright
  because the Jammy wrapper runs `corepack enable` as a mapped non-root user.
  Equivalent Jammy Docker commands were run with a writable `HOME`/corepack
  cache and a local `pnpm` wrapper so Linux snapshots and the Linux visual pass
  still completed.

## Verification completed

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- Jammy Linux snapshot refresh via equivalent `pnpm test:visual:update` Docker run
- Jammy Linux `pnpm test:visual`
