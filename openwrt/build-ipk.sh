#!/bin/bash
#
# Build split OpenWrt .ipk packages that mirror the feed layout:
#   - cc-switch
#   - luci-app-cc-switch

set -euo pipefail
umask 022

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DAEMON_MAKEFILE="$SCRIPT_DIR/proxy-daemon/Makefile"
LUCI_MAKEFILE="$SCRIPT_DIR/luci-app-ccswitch/Makefile"
DAEMON_SRC="$SCRIPT_DIR/proxy-daemon/files"
LUCI_SRC="$SCRIPT_DIR/luci-app-ccswitch"
STAGED_OPENWRT_PROVIDER_UI_DIR="$SCRIPT_DIR/provider-ui-dist"
STAGED_OPENWRT_PROVIDER_UI_BUNDLE="$STAGED_OPENWRT_PROVIDER_UI_DIR/ccswitch-provider-ui.js"
STAGED_OPENWRT_PROVIDER_UI_HOST_STYLESHEET="$STAGED_OPENWRT_PROVIDER_UI_DIR/openwrt-luci-host.css"
STAGED_OPENWRT_PROVIDER_UI_ICONS_DIR="$STAGED_OPENWRT_PROVIDER_UI_DIR/icons"
OPENWRT_PROVIDER_UI_ASSET="$LUCI_SRC/htdocs/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js"
OPENWRT_PROVIDER_UI_HOST_STYLESHEET="$LUCI_SRC/htdocs/luci-static/resources/ccswitch/provider-ui/openwrt-luci-host.css"
OPENWRT_PROVIDER_UI_ICONS_DIR="$LUCI_SRC/htdocs/luci-static/resources/ccswitch/provider-ui/icons"
PREPARE_PROVIDER_UI_BUNDLE="$SCRIPT_DIR/prepare-provider-ui-bundle.sh"

read_make_var() {
	local file="$1"
	local key="$2"

	sed -n "s/^${key}:=//p" "$file" | head -n 1
}

DEFAULT_VERSION="$(read_make_var "$DAEMON_MAKEFILE" PKG_VERSION)"
DEFAULT_RELEASE="$(read_make_var "$DAEMON_MAKEFILE" PKG_RELEASE)"
CC_SWITCH_LEGACY_OWNERS="luci-app-cc-switch, luci-app-open-cc-switch"

VERSION="${PKG_VERSION_OVERRIDE:-}"
PKG_RELEASE="${PKG_RELEASE_OVERRIDE:-$DEFAULT_RELEASE}"
DIST_DIR="$SCRIPT_DIR/dist"
ARCH_ALIAS=""
RUST_TARGET=""
OPKG_ARCH=""
BINARY=""
BINARY_EXPLICIT=0

usage() {
	cat <<EOF
Usage:
  $(basename "$0") [aarch64|x86_64]
  $(basename "$0") --rust-target <triple> --opkg-arch <arch> [--binary <path>]

Known targets:
  aarch64  -> aarch64-unknown-linux-musl / aarch64_generic
  x86_64   -> x86_64-unknown-linux-musl  / x86_64

Options:
  --binary <path>       Use a prebuilt cc-switch binary instead of the default
  --dist-dir <path>     Output directory for generated .ipk files
  --version <version>   Override the package version
  --release <release>   Override the package release
  --list-targets        Print the built-in target mappings
  -h, --help            Show this help text

For targets not listed above, pass both --rust-target and --opkg-arch.
The standalone builder expects a statically linked musl binary so runtime
dependencies remain predictable outside the OpenWrt SDK.

Environment:
  CCSWITCH_IPK_SKIP_UI_REBUILD=1      Skip the automatic OpenWrt provider UI rebuild
  CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE Use an explicit prebuilt provider UI bundle
EOF
}

list_targets() {
	cat <<'EOF'
aarch64  aarch64-unknown-linux-musl  aarch64_generic
x86_64   x86_64-unknown-linux-musl   x86_64
EOF
}

die() {
	echo "ERROR: $*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

git_describe_version() {
	git -C "$PROJECT_DIR" describe --tags --always --dirty 2>/dev/null || true
}

rebuild_openwrt_provider_ui_bundle() {
	echo "Rebuilding OpenWrt provider UI bundle"
	if ! (
		cd "$PROJECT_DIR"
		if [ -x "./node_modules/.bin/vite" ]; then
			CCSWITCH_BUILD_TARGET=openwrt-provider-ui ./node_modules/.bin/vite build
		elif command -v pnpm >/dev/null 2>&1; then
			pnpm build:openwrt-provider-ui
		else
			die "pnpm is required to rebuild the OpenWrt provider UI bundle. Run \`pnpm install --frozen-lockfile\` first, then rerun $0."
		fi
	); then
		die "failed to rebuild the OpenWrt provider UI bundle. Run \`pnpm install --frozen-lockfile\` first, then rerun $0."
	fi

	[ -f "$STAGED_OPENWRT_PROVIDER_UI_BUNDLE" ] || die "pnpm reported success but did not produce: $STAGED_OPENWRT_PROVIDER_UI_BUNDLE"
	[ -f "$STAGED_OPENWRT_PROVIDER_UI_HOST_STYLESHEET" ] || die "pnpm reported success but did not produce: $STAGED_OPENWRT_PROVIDER_UI_HOST_STYLESHEET"
	[ -d "$STAGED_OPENWRT_PROVIDER_UI_ICONS_DIR" ] || die "pnpm reported success but did not produce: $STAGED_OPENWRT_PROVIDER_UI_ICONS_DIR"
}

ensure_openwrt_provider_ui_asset() {
	[ -x "$PREPARE_PROVIDER_UI_BUNDLE" ] || die "missing provider UI bundle helper: $PREPARE_PROVIDER_UI_BUNDLE"

	if [ -n "${CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE:-}" ]; then
		echo "Using explicit OpenWrt provider UI bundle from CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE"
	elif [ "${CCSWITCH_IPK_SKIP_UI_REBUILD:-}" = "1" ]; then
		echo "Skipping OpenWrt provider UI rebuild because CCSWITCH_IPK_SKIP_UI_REBUILD=1"
		[ -f "$STAGED_OPENWRT_PROVIDER_UI_BUNDLE" ] || die "CCSWITCH_IPK_SKIP_UI_REBUILD=1 was set but the staged provider UI bundle is missing: $STAGED_OPENWRT_PROVIDER_UI_BUNDLE"
		[ -f "$STAGED_OPENWRT_PROVIDER_UI_HOST_STYLESHEET" ] || die "CCSWITCH_IPK_SKIP_UI_REBUILD=1 was set but the staged provider UI host stylesheet is missing: $STAGED_OPENWRT_PROVIDER_UI_HOST_STYLESHEET"
	else
		rebuild_openwrt_provider_ui_bundle
	fi

	"$PREPARE_PROVIDER_UI_BUNDLE" --output-dir "$(dirname "$OPENWRT_PROVIDER_UI_ASSET")"
	[ -f "$OPENWRT_PROVIDER_UI_ASSET" ] || die "expected OpenWrt provider UI bundle was not produced: $OPENWRT_PROVIDER_UI_ASSET"
	[ -f "$OPENWRT_PROVIDER_UI_HOST_STYLESHEET" ] || die "expected OpenWrt provider UI host stylesheet was not produced: $OPENWRT_PROVIDER_UI_HOST_STYLESHEET"
	[ -d "$OPENWRT_PROVIDER_UI_ICONS_DIR" ] || die "expected OpenWrt provider UI icon directory was not produced: $OPENWRT_PROVIDER_UI_ICONS_DIR"
}

parse_args() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
			aarch64|x86_64)
				[ -z "$ARCH_ALIAS" ] || die "architecture specified more than once"
				ARCH_ALIAS="$1"
				;;
			--rust-target)
				shift
				[ "$#" -gt 0 ] || die "--rust-target requires a value"
				RUST_TARGET="$1"
				;;
			--opkg-arch)
				shift
				[ "$#" -gt 0 ] || die "--opkg-arch requires a value"
				OPKG_ARCH="$1"
				;;
			--binary)
				shift
				[ "$#" -gt 0 ] || die "--binary requires a value"
				BINARY="$1"
				BINARY_EXPLICIT=1
				;;
			--dist-dir)
				shift
				[ "$#" -gt 0 ] || die "--dist-dir requires a value"
				DIST_DIR="$1"
				;;
			--version)
				shift
				[ "$#" -gt 0 ] || die "--version requires a value"
				VERSION="$1"
				;;
			--release)
				shift
				[ "$#" -gt 0 ] || die "--release requires a value"
				PKG_RELEASE="$1"
				;;
			--list-targets)
				list_targets
				exit 0
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
}

resolve_target() {
	if [ -n "$ARCH_ALIAS" ] && { [ -n "$RUST_TARGET" ] || [ -n "$OPKG_ARCH" ]; }; then
		die "use either a built-in arch alias or the explicit --rust-target/--opkg-arch pair"
	fi

	if [ -n "$ARCH_ALIAS" ]; then
		case "$ARCH_ALIAS" in
			aarch64)
				RUST_TARGET="aarch64-unknown-linux-musl"
				OPKG_ARCH="aarch64_generic"
				;;
			x86_64)
				RUST_TARGET="x86_64-unknown-linux-musl"
				OPKG_ARCH="x86_64"
				;;
		esac
	fi

	if [ -z "$RUST_TARGET" ] && [ -z "$OPKG_ARCH" ]; then
		RUST_TARGET="aarch64-unknown-linux-musl"
		OPKG_ARCH="aarch64_generic"
	fi

	[ -n "$RUST_TARGET" ] || die "--opkg-arch requires --rust-target"
	[ -n "$OPKG_ARCH" ] || die "--rust-target requires --opkg-arch"

	if [ -z "$BINARY" ]; then
		BINARY="$PROJECT_DIR/proxy-daemon/target/$RUST_TARGET/release/cc-switch"
	fi
}

validate_package_metadata() {
	local luci_version luci_release described_version

	[ -n "$DEFAULT_VERSION" ] || die "failed to determine package version from $DAEMON_MAKEFILE"
	[ -n "$DEFAULT_RELEASE" ] || die "failed to determine package release from $DAEMON_MAKEFILE"

	luci_version="$(read_make_var "$LUCI_MAKEFILE" PKG_VERSION)"
	luci_release="$(read_make_var "$LUCI_MAKEFILE" PKG_RELEASE)"

	[ "$DEFAULT_VERSION" = "$luci_version" ] || die "package version mismatch between daemon and LuCI makefiles"
	[ "$DEFAULT_RELEASE" = "$luci_release" ] || die "package release mismatch between daemon and LuCI makefiles"

	if [ -z "$VERSION" ]; then
		described_version="$(git_describe_version)"
		if [ -n "$described_version" ]; then
			VERSION="$described_version"
		else
			VERSION="$DEFAULT_VERSION"
		fi
	fi

	[ -n "$VERSION" ] || die "effective package version is empty"
	[ -n "$PKG_RELEASE" ] || die "effective package release is empty"
}

assert_inputs() {
	require_command tar
	require_command sed
	require_command mktemp
	require_command file
	require_command install
	require_command find
	require_command ar

	[ -f "$BINARY" ] || die "binary not found: $BINARY
Build it first with:
  cd proxy-daemon && cargo build --release --target $RUST_TARGET"

	[ -f "$DAEMON_SRC/etc/config/ccswitch" ] || die "missing daemon config template"
	[ -f "$DAEMON_SRC/etc/init.d/ccswitch" ] || die "missing daemon init script"
	[ -f "$LUCI_SRC/root/usr/share/rpcd/acl.d/luci-app-ccswitch.json" ] || die "missing rpcd ACL file"
	[ -f "$LUCI_SRC/root/usr/share/rpcd/ucode/ccswitch" ] || die "missing rpcd ucode handler"
	[ -f "$LUCI_SRC/root/usr/share/luci/menu.d/luci-app-ccswitch.json" ] || die "missing LuCI menu file"
	[ -f "$LUCI_SRC/htdocs/luci-static/resources/view/ccswitch/settings.js" ] || die "missing LuCI settings view"
	[ -f "$OPENWRT_PROVIDER_UI_ASSET" ] || die "missing OpenWrt provider UI bundle"
	[ -f "$OPENWRT_PROVIDER_UI_HOST_STYLESHEET" ] || die "missing OpenWrt provider UI host stylesheet"
	[ -d "$OPENWRT_PROVIDER_UI_ICONS_DIR" ] || die "missing OpenWrt provider UI icons directory"
}

install_openwrt_provider_ui_icons() {
	local source_dir="$1"
	local dest_dir="$2"
	local icon_path rel_path

	[ -d "$source_dir" ] || return 0

	while IFS= read -r -d '' icon_path; do
		rel_path="${icon_path#$source_dir/}"
		install -d "$(dirname "$dest_dir/$rel_path")"
		install -m 0644 "$icon_path" "$dest_dir/$rel_path"
	done < <(find "$source_dir" -type f -print0)
}

compile_luci_lmo_with_python() {
	local po_path="$1"
	local lmo_path="$2"

	command -v python3 >/dev/null 2>&1 || die "po2lmo is not available and python3 is required for standalone LuCI translation builds"

	python3 - "$po_path" "$lmo_path" <<'PY'
import ast
import os
import struct
import sys

po_path, lmo_path = sys.argv[1], sys.argv[2]

def u32(value):
    return value & 0xffffffff

def get16(data, pos):
    return data[pos] | (data[pos + 1] << 8)

def signed_byte(value):
    return value - 256 if value >= 128 else value

def sfh_hash(text):
    data = text.encode("utf-8")
    length = len(data)
    h = length
    pos = 0
    rem = length & 3
    count = length >> 2

    for _ in range(count):
        h = u32(h + get16(data, pos))
        tmp = u32((get16(data, pos + 2) << 11) ^ h)
        h = u32((h << 16) ^ tmp)
        pos += 4
        h = u32(h + (h >> 11))

    if rem == 3:
        h = u32(h + get16(data, pos))
        h = u32(h ^ (h << 16))
        h = u32(h ^ (signed_byte(data[pos + 2]) << 18))
        h = u32(h + (h >> 11))
    elif rem == 2:
        h = u32(h + get16(data, pos))
        h = u32(h ^ (h << 11))
        h = u32(h + (h >> 17))
    elif rem == 1:
        h = u32(h + signed_byte(data[pos]))
        h = u32(h ^ (h << 10))
        h = u32(h + (h >> 1))

    h = u32(h ^ (h << 3))
    h = u32(h + (h >> 5))
    h = u32(h ^ (h << 4))
    h = u32(h + (h >> 17))
    h = u32(h ^ (h << 25))
    h = u32(h + (h >> 6))
    return h

def parse_po(path):
    entries = []
    current = None
    field = None

    def flush():
        nonlocal current, field
        if current is not None and "msgid" in current:
            entries.append(current)
        current = None
        field = None

    with open(path, "r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.rstrip("\n")
            if not line.strip() or line.startswith("#"):
                continue
            if line.startswith("msgid "):
                flush()
                current = {"msgid": ast.literal_eval(line[6:].strip())}
                field = "msgid"
            elif line.startswith("msgstr "):
                if current is None:
                    raise ValueError(f"msgstr before msgid in {path}")
                current["msgstr"] = ast.literal_eval(line[7:].strip())
                field = "msgstr"
            elif line.startswith('"') and field:
                current[field] += ast.literal_eval(line.strip())
            elif line.startswith("msgid_plural") or line.startswith("msgstr["):
                raise ValueError(f"plural PO entries are not supported by the standalone compiler: {path}")

    flush()
    return entries

def plural_formula(header):
    for line in header.splitlines():
        if line.startswith("Plural-Forms:"):
            value = line.split(":", 1)[1].strip()
            for part in value.split(";"):
                part = part.strip()
                if part.startswith("plural="):
                    return part + ";"
    return None

data = bytearray()
index = []

for entry in parse_po(po_path):
    msgid = entry.get("msgid", "")
    msgstr = entry.get("msgstr", "")
    if msgid == "":
        formula = plural_formula(msgstr)
        if formula:
            encoded = formula.encode("utf-8")
            index.append((0, 0, len(data), len(encoded)))
            data.extend(encoded)
            while len(data) % 4:
                data.append(0)
        continue
    if not msgstr:
        continue

    key_id = sfh_hash(msgid)
    if key_id == sfh_hash(msgstr):
        continue

    encoded = msgstr.encode("utf-8")
    index.append((key_id, 1, len(data), len(encoded)))
    data.extend(encoded)
    while len(data) % 4:
        data.append(0)

if not index:
    try:
        os.unlink(lmo_path)
    except FileNotFoundError:
        pass
    sys.exit(0)

os.makedirs(os.path.dirname(lmo_path), exist_ok=True)
index.sort(key=lambda item: item[0])
offset = len(data)
with open(lmo_path, "wb") as fh:
    fh.write(data)
    for item in index:
        fh.write(struct.pack("!IIII", *item))
    fh.write(struct.pack("!I", offset))
PY
}

compile_luci_i18n() {
	local output_dir="$1"
	local po_path lang pkg lmo_path

	rm -rf "$output_dir"
	mkdir -p "$output_dir"

	[ -d "$LUCI_SRC/po" ] || return 0

	while IFS= read -r -d '' po_path; do
		lang="$(basename "$(dirname "$po_path")")"
		pkg="$(basename "$po_path" .po)"
		lmo_path="$output_dir/$pkg.$lang.lmo"

		if command -v po2lmo >/dev/null 2>&1; then
			po2lmo "$po_path" "$lmo_path"
		else
			compile_luci_lmo_with_python "$po_path" "$lmo_path"
		fi
	done < <(find "$LUCI_SRC/po" -name '*.po' -print0)
}

install_luci_i18n() {
	local source_dir="$1"
	local dest_dir="$2"
	local lmo_path

	[ -d "$source_dir" ] || return 0

	while IFS= read -r -d '' lmo_path; do
		install -m 0644 "$lmo_path" "$dest_dir/$(basename "$lmo_path")"
	done < <(find "$source_dir" -name '*.lmo' -print0)
}

musl_cc_for_target() {
	case "$RUST_TARGET" in
		aarch64-unknown-linux-musl)
			printf '%s\n' "aarch64-linux-musl-gcc"
			;;
		x86_64-unknown-linux-musl)
			printf '%s\n' "x86_64-linux-musl-gcc"
			;;
		*)
			return 1
			;;
	esac
}

configure_musl_bindgen_sysroot() {
	local cc env_name sysroot

	case "$RUST_TARGET" in
		*-linux-musl)
			;;
		*)
			return 0
			;;
	esac

	cc="$(musl_cc_for_target || true)"
	[ -n "$cc" ] || return 0
	command -v "$cc" >/dev/null 2>&1 || return 0

	sysroot="$("$cc" -print-sysroot 2>/dev/null || true)"
	[ -n "$sysroot" ] || return 0
	[ -d "$sysroot/usr/include" ] || return 0

	env_name="BINDGEN_EXTRA_CLANG_ARGS_${RUST_TARGET//-/_}"
	if [ -z "${!env_name:-}" ]; then
		export "$env_name=--sysroot=$sysroot"
	fi
}

build_daemon_binary() {
	if [ "$BINARY_EXPLICIT" -eq 1 ]; then
		return
	fi

	require_command cargo
	configure_musl_bindgen_sysroot

	echo "Building fresh cc-switch daemon binary for $RUST_TARGET"
	(
		cd "$PROJECT_DIR/proxy-daemon"
		cargo build --release --target "$RUST_TARGET"
	)
}

assert_static_binary() {
	local file_output

	file_output="$(file "$BINARY")"
	case "$file_output" in
		*"statically linked"*|*"static-pie linked"*)
			;;
		*)
			die "standalone IPK builds require a statically linked musl binary.
Binary inspection result:
  $file_output"
			;;
	esac
}

setup_tar_flags() {
	if tar --version 2>/dev/null | grep -q 'GNU tar'; then
		TAR_FLAGS=(--format=ustar --owner=0 --group=0 --numeric-owner)
	else
		TAR_FLAGS=(--format ustar --uid 0 --gid 0 --uname root --gname root)
	fi
}

tar_from_dir() {
	local src_dir="$1"
	local output="$2"

	COPYFILE_DISABLE=1 tar "${TAR_FLAGS[@]}" -czf "$output" -C "$src_dir" .
}

tar_from_files() {
	local cwd="$1"
	local output="$2"
	shift 2

	(
		cd "$cwd"
		COPYFILE_DISABLE=1 tar "${TAR_FLAGS[@]}" -czf "$output" "$@"
	)
}

build_ipk() {
	local control_dir="$1"
	local data_dir="$2"
	local output="$3"
	local pkg_dir output_abs
	pkg_dir="$WORK_DIR/$(basename "$output" .ipk)"
	output_abs="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"

	rm -rf "$pkg_dir"
	mkdir -p "$pkg_dir"

	printf '2.0\n' > "$pkg_dir/debian-binary"
	tar_from_dir "$control_dir" "$pkg_dir/control.tar.gz"
	tar_from_dir "$data_dir" "$pkg_dir/data.tar.gz"
	(
		cd "$pkg_dir"
		ar -q -S "$output_abs" debian-binary control.tar.gz data.tar.gz >/dev/null
	)
}

emit_default_postinst_wrapper() {
	local path="$1"

	cat > "$path" <<'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
default_postinst $0 "$@"
EOF
	chmod 0755 "$path"
}

emit_default_prerm_wrapper() {
	local path="$1"

	cat > "$path" <<'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
default_prerm $0 "$@"
EOF
	chmod 0755 "$path"
}

emit_daemon_postinst_pkg() {
	local path="$1"

	cat > "$path" <<'EOF'
#!/bin/sh
STATE_FILE="/var/run/ccswitch.enabled-before-upgrade"
[ -n "${IPKG_INSTROOT}" ] || {
	chmod 0755 /usr/bin/cc-switch 2>/dev/null || true
	chmod 0755 /etc/init.d/ccswitch 2>/dev/null || true
	if [ -f "$STATE_FILE" ]; then
		rm -f "$STATE_FILE"
		/etc/init.d/ccswitch enable >/dev/null 2>&1 || true
		/etc/init.d/ccswitch restart >/dev/null 2>&1 || true
	fi
}
exit 0
EOF
	chmod 0755 "$path"
}

emit_daemon_prerm_pkg() {
	local path="$1"

	cat > "$path" <<'EOF'
#!/bin/sh
STATE_FILE="/var/run/ccswitch.enabled-before-upgrade"
[ -n "${IPKG_INSTROOT}" ] || {
	if /etc/init.d/ccswitch enabled >/dev/null 2>&1; then
		mkdir -p "${STATE_FILE%/*}"
		: > "$STATE_FILE"
	else
		rm -f "$STATE_FILE"
	fi
}
exit 0
EOF
	chmod 0755 "$path"
}

emit_daemon_postrm() {
	local path="$1"

	cat > "$path" <<'EOF'
#!/bin/sh
STATE_FILE="/var/run/ccswitch.enabled-before-upgrade"
[ -n "${IPKG_INSTROOT}" ] || rm -f "$STATE_FILE"
exit 0
EOF
	chmod 0755 "$path"
}

emit_luci_postinst_pkg() {
	local path="$1"

	cat > "$path" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/*
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	/etc/init.d/uhttpd reload >/dev/null 2>&1 || /etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}
exit 0
EOF
	chmod 0755 "$path"
}

emit_luci_postrm() {
	local path="$1"

	cat > "$path" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/*
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	/etc/init.d/uhttpd reload >/dev/null 2>&1 || /etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}
exit 0
EOF
	chmod 0755 "$path"
}

emit_control_file() {
	local path="$1"
	local package_name="$2"
	local section="$3"
	local arch="$4"
	local depends="$5"
	local description="$6"
	local replaces="${7:-}"

	cat > "$path" <<EOF
Package: $package_name
Version: $VERSION-$PKG_RELEASE
Section: $section
Architecture: $arch
Maintainer: kuno <noreply@github.com>
EOF

	if [ -n "$depends" ]; then
		cat >> "$path" <<EOF
Depends: $depends
EOF
	fi

	if [ -n "$replaces" ]; then
		cat >> "$path" <<EOF
Replaces: $replaces
EOF
	fi

	cat >> "$path" <<EOF
Description: $description
EOF
}

build_daemon_package() {
	local control_dir="$WORK_DIR/cc-switch-control"
	local data_dir="$WORK_DIR/cc-switch-data"
	local output="$DIST_DIR/cc-switch_${VERSION}-${PKG_RELEASE}_${OPKG_ARCH}.ipk"

	rm -rf "$control_dir" "$data_dir"
	mkdir -p "$control_dir" "$data_dir/usr/bin" "$data_dir/etc/config" "$data_dir/etc/init.d"

	emit_control_file \
		"$control_dir/control" \
		"cc-switch" \
		"net" \
		"$OPKG_ARCH" \
		"" \
		"CC Switch AI API proxy daemon for OpenWrt
 Standalone proxy daemon with procd integration and UCI-managed runtime settings." \
		"$CC_SWITCH_LEGACY_OWNERS"

	emit_default_postinst_wrapper "$control_dir/postinst"
	emit_daemon_postinst_pkg "$control_dir/postinst-pkg"
	emit_default_prerm_wrapper "$control_dir/prerm"
	emit_daemon_prerm_pkg "$control_dir/prerm-pkg"
	emit_daemon_postrm "$control_dir/postrm"

	cat > "$control_dir/conffiles" <<'EOF'
/etc/config/ccswitch
EOF

	install -m 0755 "$BINARY" "$data_dir/usr/bin/cc-switch"
	install -m 0644 "$DAEMON_SRC/etc/config/ccswitch" "$data_dir/etc/config/ccswitch"
	install -m 0755 "$DAEMON_SRC/etc/init.d/ccswitch" "$data_dir/etc/init.d/ccswitch"

	rm -f "$output"
	build_ipk "$control_dir" "$data_dir" "$output"
}

build_luci_package() {
	local control_dir="$WORK_DIR/luci-control"
	local data_dir="$WORK_DIR/luci-data"
	local i18n_dir="$WORK_DIR/luci-i18n"
	local output="$DIST_DIR/luci-app-cc-switch_${VERSION}-${PKG_RELEASE}_all.ipk"

	rm -rf "$control_dir" "$data_dir"
	mkdir -p \
		"$control_dir" \
		"$data_dir/usr/share/rpcd/acl.d" \
		"$data_dir/usr/share/rpcd/ucode" \
		"$data_dir/usr/lib/lua/luci/i18n" \
		"$data_dir/usr/share/luci/menu.d" \
		"$data_dir/www/luci-static/resources/view/ccswitch" \
		"$data_dir/www/luci-static/resources/ccswitch/provider-ui" \
		"$data_dir/www/luci-static/resources/ccswitch/provider-ui/icons"

	emit_control_file \
		"$control_dir/control" \
		"luci-app-cc-switch" \
		"luci" \
		"all" \
		"cc-switch, luci-base, rpcd-mod-ucode" \
		"LuCI support for CC Switch
 Web UI, rpcd ACLs, and OpenWrt-specific management hooks for cc-switch." \
		""

	emit_default_postinst_wrapper "$control_dir/postinst"
	emit_luci_postinst_pkg "$control_dir/postinst-pkg"
	emit_luci_postrm "$control_dir/postrm"

	install -m 0644 \
		"$LUCI_SRC/root/usr/share/rpcd/acl.d/luci-app-ccswitch.json" \
		"$data_dir/usr/share/rpcd/acl.d/luci-app-ccswitch.json"
	install -m 0644 \
		"$LUCI_SRC/root/usr/share/rpcd/ucode/ccswitch" \
		"$data_dir/usr/share/rpcd/ucode/ccswitch"
	install -m 0644 \
		"$LUCI_SRC/root/usr/share/luci/menu.d/luci-app-ccswitch.json" \
		"$data_dir/usr/share/luci/menu.d/luci-app-ccswitch.json"
	install -m 0644 \
		"$LUCI_SRC/htdocs/luci-static/resources/view/ccswitch/settings.js" \
		"$data_dir/www/luci-static/resources/view/ccswitch/settings.js"
	install -m 0644 \
		"$OPENWRT_PROVIDER_UI_ASSET" \
		"$data_dir/www/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js"
	install -m 0644 \
		"$OPENWRT_PROVIDER_UI_HOST_STYLESHEET" \
		"$data_dir/www/luci-static/resources/ccswitch/provider-ui/openwrt-luci-host.css"
	install_openwrt_provider_ui_icons \
		"$OPENWRT_PROVIDER_UI_ICONS_DIR" \
		"$data_dir/www/luci-static/resources/ccswitch/provider-ui/icons"
	compile_luci_i18n "$i18n_dir"
	install_luci_i18n \
		"$i18n_dir" \
		"$data_dir/usr/lib/lua/luci/i18n"

	rm -f "$output"
	build_ipk "$control_dir" "$data_dir" "$output"
}

print_checksums() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$@"
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$@"
	fi
}

parse_args "$@"
resolve_target
validate_package_metadata
ensure_openwrt_provider_ui_asset
build_daemon_binary
assert_inputs
assert_static_binary
setup_tar_flags

mkdir -p "$DIST_DIR"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ccswitch-ipk.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Building OpenWrt IPKs"
echo "  Version:      $VERSION-$PKG_RELEASE"
echo "  Rust target:  $RUST_TARGET"
echo "  OpenWrt arch: $OPKG_ARCH"
echo "  Binary:       $BINARY"
echo "  Dist dir:     $DIST_DIR"

build_daemon_package
build_luci_package

DAEMON_IPK="$DIST_DIR/cc-switch_${VERSION}-${PKG_RELEASE}_${OPKG_ARCH}.ipk"
LUCI_IPK="$DIST_DIR/luci-app-cc-switch_${VERSION}-${PKG_RELEASE}_all.ipk"

echo
echo "Built packages:"
echo "  $DAEMON_IPK"
echo "  $LUCI_IPK"

if command -v ls >/dev/null 2>&1; then
	ls -lh "$DAEMON_IPK" "$LUCI_IPK"
fi

echo
echo "SHA256:"
print_checksums "$DAEMON_IPK" "$LUCI_IPK"

echo
echo "Install on router:"
echo "  opkg install /tmp/$(basename "$DAEMON_IPK") /tmp/$(basename "$LUCI_IPK")"
