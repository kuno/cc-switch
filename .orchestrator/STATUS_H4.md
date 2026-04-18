# STATUS_H4

## Scope landed

H4 adds DaemonCard-only regression coverage without changing any production code
under `src/openwrt-provider-ui/`.

Files added or updated:

- `tests/openwrt/visual/harness/entries.tsx`
- `tests/openwrt/visual/daemon-card.spec.ts`
- `tests/openwrt/component/daemon-card.test.tsx`
- `tests/openwrt/component/daemon-card.hardrules.test.tsx`
- Linux baselines under
  `tests/openwrt/visual/__snapshots__/{openwrt-light,openwrt-dark}/daemon-card.spec.ts/`

## Harness states

`tests/openwrt/visual/harness/entries.tsx` now exposes `DaemonCard` scenarios:

- `running` — running + healthy
- `stopped` — stopped + stopped health
- `pending` — running + healthy + `restartPending: true` + info note
- `restarting` — running + healthy + `restartInFlight: true`
- `error` — running + unknown health + error note

Each state is covered in both light and dark themes by
`tests/openwrt/visual/daemon-card.spec.ts`.

## RTL findings

`tests/openwrt/component/daemon-card.test.tsx` confirms the actual DaemonCard
contract, which is prop-driven rather than bridge-driven:

- Status chip labels are only `Running` / `Stopped`
- Health chip labels are `Healthy`, `Stopped`, and `Unknown` for the states under test
- `restartPending` changes the hint copy to
  `Restart pending to apply provider changes.` and does not disable Restart
- `restartInFlight` changes the hint copy to `Restarting daemon now.`, swaps the
  button label to `Restarting…`, and disables Restart
- Error rendering is the page-note copy passed in through `message`
- Keyboard activation works with both Enter and Space on the Restart button
- Double-clicking Restart only calls `restartService` once when the card flips
  into optimistic in-flight state

## ARIA and subscription findings

- `DaemonCard` does **not** emit `aria-busy` or `aria-live`; H4 therefore pins
  the visible optimistic copy (`Restarting…` and `Restarting daemon now.`)
  instead of asserting attributes the component does not own
- `DaemonCard` does **not** call `subscribe`; subscription wiring lives in
  `OpenWrtPageShell`, so no direct subscription assertion was added here

## Hard rules

`tests/openwrt/component/daemon-card.hardrules.test.tsx` asserts the card never
reintroduces:

- `Failover`
- `OpenClaw`
- `Hermes`
- `Configure routes and provider details`
- failover toggles / queue-ordering controls
- `.owt-legacy-preserved`

## Verification completed

macOS:

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- post-Docker restore: `CI=true pnpm install --frozen-lockfile`
- post-Docker sanity: `pnpm typecheck`
- post-Docker sanity: `pnpm test:component`

Linux (Jammy Playwright image):

- `corepack pnpm install --frozen-lockfile && corepack pnpm test:visual:update`
- `corepack pnpm install --frozen-lockfile && corepack pnpm test:visual`

## Seam flags

- In this environment, the checked-in `pnpm test:visual:update:linux` wrapper
  failed because `corepack enable` could not write `/usr/bin/pnpm` inside the
  container. H4 used an equivalent one-off Docker command with
  `HOME=/tmp COREPACK_HOME=/tmp/corepack` and a temporary `/tmp/bin/pnpm`
  shim, without changing repo scripts. H7 can centralize that wrapper fix.
- No production seam was needed for DaemonCard itself.
