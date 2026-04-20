#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
css_file=${1:-"$script_dir/openwrt-provider-ui.css"}

if grep -nE '^[[:space:]]*\.owt-' "$css_file"; then
  echo "FAIL: unscoped .owt-* selectors found"
  exit 1
fi

echo "OK: all .owt-* selectors are shell-scoped"
