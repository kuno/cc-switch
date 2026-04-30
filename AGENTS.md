# Repository Instructions

@/Users/qingguan/.codex/RTK.md

## OpenWrt Deploy Guardrails

For OpenWrt and iStoreOS package deploys, do not trust local branch state or
memory. Use this checklist every time:

1. Fresh-fetch the exact remote ref being deployed. Do not build from a stale
   local tracking ref.
2. Record the deploy tuple before building: target branch, commit SHA, expected
   package version, and supported DB schema version.
3. Check router compatibility before install: current installed package
   version, daemon version, and on-device DB schema/version compatibility.
4. Keep the exact known-good rollback IPKs ready before installing a new build.
5. Treat deploy as two stages:
   - install the IPKs
   - verify daemon startup plus `/openwrt/admin/meta` and `/openwrt/admin/runtime`
6. If startup or schema compatibility fails, roll back immediately before doing
   further debugging.
7. When building from a temporary branch or worktree, verify its base commit
   against the intended upstream ref before publishing or deploying.
