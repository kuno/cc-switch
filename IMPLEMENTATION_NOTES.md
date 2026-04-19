# IPK Build Stale SPA Fix

## Files touched

- `.gitignore`
- `openwrt/build-ipk.sh`
- `openwrt/prepare-provider-ui-bundle.sh`
- `tests/ipkSpaSentinel.test.ts`
- `tests/openwrt/fixtures/ipk-spa-sentinels.ts`
- `tests/openwrt/fixtures/openwrtProviderUiBuild.ts`
- `tests/openwrt/providerUiBundle.test.ts`

## Guidance deviations

- The fast sentinel test lives in `tests/ipkSpaSentinel.test.ts` instead of under `tests/openwrt/`.
  Justification: the default `vitest.config.ts` excludes `tests/openwrt/**` unless an explicit OpenWrt target is passed, so keeping the new sentinel test at the root lets the plain `pnpm exec vitest run` path exercise it. The existing OpenWrt-specific coverage in `tests/openwrt/providerUiBundle.test.ts` was also updated to build from live source instead of relying on a committed bundle artifact.

## Verification evidence

- `pnpm install --frozen-lockfile`
  Installed the missing local `node_modules` state so the verification path exercised real Vite/Vitest execution instead of stale artifacts.
- `pnpm typecheck`
  Passed: `TypeScript: No errors found`.
- `pnpm exec vitest run tests/ipkSpaSentinel.test.ts`
  Passed: 3 tests green, 1 slow test skipped by default.
- `pnpm exec vitest run tests/openwrt/providerUiBundle.test.ts`
  Passed: 14 tests green.
- `pnpm exec vitest run --config vitest.openwrt-component.config.ts`
  Passed: 19 files, 71 tests green.
- `CCSWITCH_RUN_IPK_BUILD_TEST=1 pnpm exec vitest run tests/ipkSpaSentinel.test.ts`
  Passed: 4 tests green, including the offline luci IPK extraction/sentinel assertion.
- `/bin/bash openwrt/build-ipk.sh aarch64`
  Passed. Extracted `openwrt/dist/luci-app-cc-switch_v3.13.0-279-g02cdecf7-dirty-1_all.ipk`, unpacked `data.tar.gz`, and verified bundle sentinels via `grep`:
  `uploadClaudeAuth`, `removeClaudeAuth`, `mountRuntimeSurface`, and CSS sentinel `ccswitch-openwrt-provider-ui-positioner`.
- `CCSWITCH_IPK_SKIP_UI_REBUILD=1 /bin/bash openwrt/build-ipk.sh aarch64 --binary proxy-daemon/target/aarch64-unknown-linux-musl/release/cc-switch`
  Passed and emitted `Skipping OpenWrt provider UI rebuild because CCSWITCH_IPK_SKIP_UI_REBUILD=1`.
- `shellcheck openwrt/build-ipk.sh openwrt/prepare-provider-ui-bundle.sh`
  Passed after fixing one `SC2155` and two `SC1007` warnings.
- `pnpm exec vitest run`
  The broad non-OpenWrt suite emitted many passing test results but did not terminate cleanly in this environment, so I killed the lingering worker and relied on the targeted OpenWrt verification above for this PR. No failures from this change appeared before the hang.
