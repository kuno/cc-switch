#!/bin/bash
#
# Build only the LuCI OpenWrt .ipk:
#   - luci-app-cc-switch
#
# This intentionally does not build or package the cc-switch daemon.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/build-ipk.sh" --package luci "$@"
