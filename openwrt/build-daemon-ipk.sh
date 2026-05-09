#!/bin/bash
#
# Build only the daemon OpenWrt .ipk:
#   - cc-switch
#
# This intentionally does not rebuild or package the LuCI app.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/build-ipk.sh" --package daemon "$@"
