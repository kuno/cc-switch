# STATUS_H7

## Branch / PR

- Branch: `impl/tests-integration`
- PR: https://github.com/kuno/cc-switch/pull/22
- Target: `kuno/cc-switch:openwrt-proxy`

## Merge log

Integrated the approved H1-H6 waves onto `impl/tests-integration` in order.

### H1 note

`TASK_H7.md` listed `aa631462` as the H1 tip commit, but the actual approved
`impl/tests-apps-grid` branch carried three forward commits on top of
`0947c03a`. I integrated the full approved H1 range instead of the handoff
commit alone:

- `d532fef0` <- cherry-pick of `aff34550` (`test(openwrt): add apps grid visual coverage`)
- `73ef24ce` <- cherry-pick of `af1bf2b7` (`test(openwrt): add apps grid component coverage`)
- `bb07a9d0` <- cherry-pick of `aa631462` (`test(openwrt): document H1 handoff`)

### H2-H6

- `44c87066` <- cherry-pick of `a96663f5` (`Add activity drawer regression coverage`)
- `96291871` <- cherry-pick of `742e88ac` (`test: add provider side panel regressions`)
- `5c9618aa` <- cherry-pick of `6be24c28` (`test: add daemon card regressions`)
- `b1476e68` <- cherry-pick of `e76de636` (`test: expand alert strip regression coverage`)
- `5080296a` <- cherry-pick of `e11d31c8` (`Add OpenWrt page shell regression coverage`)

### H7 repo-level commits

- `346508b0` `test(openwrt): fix linux visual wrapper`
- `983ee421` `test(openwrt): isolate regression configs from upstream ci`
- `2897fd1b` `test(openwrt): allow explicit openwrt vitest targets`
- `61df3bdf` `test(openwrt): use corepack in visual web server`

## Conflict notes

No conflict surfaced outside the expected harness seams from `TASK_H7.md`.

- H2: `tests/openwrt/visual/harness/entries.tsx`
- H3: `tests/openwrt/visual/harness/entries.tsx`, `tests/openwrt/visual/harness/styles.css`
- H4: `tests/openwrt/visual/harness/entries.tsx`
- H5: `tests/openwrt/visual/harness/entries.tsx`, `tests/openwrt/visual/harness/styles.css`
- H6: `tests/openwrt/visual/harness/entries.tsx`, `tests/openwrt/visual/harness/styles.css`

Resolution approach in every case:

- preserve every previously-landed harness state
- append the incoming wave's new component/state registrations
- keep utility CSS additive (`--drawer`, `--panel`, `--narrow`, `--shell`)
- avoid changing test logic outside those seam files

There were no key collisions in the merged harness registry and no conflicts in
`package.json` / `pnpm-lock.yaml`.

## Wrapper fix verification

The H0 wrapper failure (`corepack enable` writing to `/usr/bin/pnpm`) is fixed by:

- `test:visual:linux`
- `test:visual:update:linux`
- `playwright.openwrt.config.ts` `webServer.command` using `corepack pnpm`

Verification:

- `pnpm test:visual:linux` -> `94 passed (31.1s)` inside
  `mcr.microsoft.com/playwright:v1.59.1-jammy`
- The wrapper now gets through Corepack bootstrap and dependency install without
  the manual `/tmp/pnpm` / PATH workaround used in H1-H6.

## Isolation boundary

### Upstream `main` PR CI path

The upstream root unit path is `pnpm test:unit` (`vitest run` via
`vitest.config.ts`).

- `vitest.config.ts` now excludes `tests/openwrt/**` by default.
- Explicit OpenWrt targets still work, so
  `pnpm vitest run tests/openwrt/providerUiBundle.test.ts` remains valid.

### OpenWrt fork PR CI path

The fork-specific regression path is:

- `.github/workflows/openwrt-ui-regression.yml`
- `pnpm test:component`
- `pnpm build:openwrt-provider-ui`
- `pnpm test:visual:ci`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`

### Proof of disjointness

- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts` -> `14 passed`
- `pnpm test:component` -> `19 files`, `69 tests` passed
- `pnpm test:visual:linux` -> `94 passed`
- `CI=true pnpm test:unit --reporter=verbose` wrote `/tmp/h7-test-unit-ci.log`
  with `OPENWRT_HITS=0` for `tests/openwrt`
- `playwright.config.ts` was renamed to `playwright.openwrt.config.ts`
  and OpenWrt visual scripts now point at the renamed file

## Verification summary

Green on this branch:

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- `pnpm test:visual:linux`

Additional notes:

- `pnpm test:unit` isolation is correct (`0` `tests/openwrt/**` hits), but the
  non-OpenWrt suite itself hangs after running many upstream tests. The same
  hang reproduces from the base `openwrt-proxy` branch (`/tmp/base-test-unit.log`),
  so this is not introduced by H7.
- `pnpm format:check` fails on both this branch and `openwrt-proxy` because of
  pre-existing `src/**` formatting drift outside H7's allowed scope. I did not
  modify production files to chase those unrelated warnings.
