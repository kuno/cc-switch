#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
main_css=${1:-"$script_dir/openwrt-provider-ui.css"}
host_css=${2:-"$script_dir/openwrt-luci-host.css"}
failed=0

if grep -nE '^[[:space:]]*(body|html|#ccswitch-openwrt-native-page-root)\b|\.cbi-' "$main_css"; then
  echo "FAIL: shadow CSS still contains LuCI host selectors"
  failed=1
fi

if grep -nE '^[[:space:]]*\.ccswitch-openwrt-provider-ui-shell[[:space:]]+\.owt-' "$main_css"; then
  echo "FAIL: shadow CSS still contains shell-prefixed .owt-* selectors"
  failed=1
fi

if grep -nE ':host|\.owt-|#ccswitch-shared-provider-ui-root|#ccswitch-shared-runtime-surface-root|\.ccswitch-openwrt-provider-ui-host' "$host_css"; then
  echo "FAIL: LuCI host CSS still contains shadow-only selectors"
  failed=1
fi

if ! grep -qE '^[[:space:]]*(body|html|#ccswitch-openwrt-native-page-root)\b|\.cbi-' "$host_css"; then
  echo "FAIL: LuCI host CSS does not contain any LuCI host selectors"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "OK: CSS shadow/host selector split matches the new contract"
