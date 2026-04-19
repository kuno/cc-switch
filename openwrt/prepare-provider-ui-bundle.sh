#!/bin/sh

set -eu

SCRIPT_DIR=$(
	CDPATH='' cd -- "$(dirname "$0")" && pwd
)
PROJECT_DIR=$(
	CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd
)
EMITTED_DIR="$SCRIPT_DIR/luci-app-ccswitch/htdocs/luci-static/resources/ccswitch/provider-ui"
STAGED_DIR="$SCRIPT_DIR/provider-ui-dist"
STAGED_BUNDLE="$STAGED_DIR/ccswitch-provider-ui.js"
STAGED_STYLESHEET="$STAGED_DIR/ccswitch-provider-ui.css"
OUTPUT_DIR=""
EXPLICIT_BUNDLE="${CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE:-}"

die() {
	echo "ERROR: $*" >&2
	exit 1
}

copy_bundle() {
	src="$1"
	dest_dir="$2"
	dest="$dest_dir/ccswitch-provider-ui.js"

	[ -f "$src" ] || die "bundle source does not exist: $src"
	mkdir -p "$dest_dir"

	if [ "$src" = "$dest" ]; then
		return
	fi

	cp "$src" "$dest"
}

copy_optional_stylesheet() {
	src="$1"
	dest_dir="$2"
	dest="$dest_dir/ccswitch-provider-ui.css"

	[ -f "$src" ] || return 0
	mkdir -p "$dest_dir"

	if [ "$src" = "$dest" ]; then
		return 0
	fi

	cp "$src" "$dest"
}

usage() {
	cat <<'EOF'
Usage:
  prepare-provider-ui-bundle.sh [--output-dir <dir>]

Resolution order:
  1. $CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE if set
  2. staged bundle under openwrt/provider-ui-dist/
  3. build via `pnpm build:openwrt-provider-ui`

Note:
  An explicit CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE is copied only to the
  requested output directory. It does not overwrite the canonical staged
  bundle under openwrt/provider-ui-dist/. If a sibling .css file exists,
  it is copied alongside the JavaScript bundle.
EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--output-dir)
			shift
			[ "$#" -gt 0 ] || die "--output-dir requires a value"
			OUTPUT_DIR="$1"
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown argument: $1"
			;;
	esac
	shift
done

if [ -z "$OUTPUT_DIR" ]; then
	OUTPUT_DIR="$EMITTED_DIR"
fi

if [ -n "$EXPLICIT_BUNDLE" ]; then
	copy_bundle "$EXPLICIT_BUNDLE" "$OUTPUT_DIR"
	copy_optional_stylesheet "${EXPLICIT_BUNDLE%.js}.css" "$OUTPUT_DIR"
	exit 0
fi

if [ -f "$STAGED_BUNDLE" ]; then
	copy_bundle "$STAGED_BUNDLE" "$OUTPUT_DIR"
	copy_optional_stylesheet "$STAGED_STYLESHEET" "$OUTPUT_DIR"
	exit 0
fi

if command -v pnpm >/dev/null 2>&1; then
	(
		cd "$PROJECT_DIR"
		pnpm build:openwrt-provider-ui
	)

	[ -f "$STAGED_BUNDLE" ] || die "pnpm reported success but did not produce: $STAGED_BUNDLE"
	copy_bundle "$STAGED_BUNDLE" "$OUTPUT_DIR"
	copy_optional_stylesheet "$STAGED_STYLESHEET" "$OUTPUT_DIR"
	exit 0
fi

die "OpenWrt provider UI bundle is missing. Either stage $STAGED_BUNDLE, set CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE, or make pnpm available so the bundle can be rebuilt."
