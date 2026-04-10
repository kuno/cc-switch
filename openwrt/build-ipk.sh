#!/bin/bash
#
# Build .ipk package for OpenWrt
# Usage: ./build-ipk.sh [aarch64|x86_64]
#
# Prerequisites:
#   - Cross-compiled cc-switch binary at:
#     proxy-daemon/target/<target>/release/cc-switch
#
# Output:
#   openwrt/dist/luci-app-open-cc-switch_0.1.0-1_<arch>.ipk

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="0.1.0"
PKG_RELEASE="1"

# Architecture mapping
ARCH="${1:-aarch64}"
case "$ARCH" in
    aarch64)
        RUST_TARGET="aarch64-unknown-linux-musl"
        OPKG_ARCH="aarch64_generic"
        ;;
    x86_64)
        RUST_TARGET="x86_64-unknown-linux-musl"
        OPKG_ARCH="x86_64"
        ;;
    *)
        echo "Usage: $0 [aarch64|x86_64]"
        exit 1
        ;;
esac

DIST_DIR="$SCRIPT_DIR/dist"
WORK_DIR="$SCRIPT_DIR/.build-tmp"
BINARY="$PROJECT_DIR/proxy-daemon/target/$RUST_TARGET/release/cc-switch"
LUCI_SRC="$SCRIPT_DIR/luci-app-ccswitch"
PKG_NAME="luci-app-open-cc-switch"

# Clean
rm -rf "$WORK_DIR" "$DIST_DIR"
mkdir -p "$DIST_DIR" "$WORK_DIR"

# --- Helper: create .ipk from control dir + data dir ---
build_ipk() {
    local control_dir="$1"
    local data_dir="$2"
    local output="$3"
    local pkg_dir="$WORK_DIR/ipk-assembly"

    rm -rf "$pkg_dir"
    mkdir -p "$pkg_dir"

    echo "2.0" > "$pkg_dir/debian-binary"

    # Use ustar format — no PAX extended headers, compatible with busybox tar on OpenWrt.
    TAR_OPTS="--format ustar --no-mac-metadata"

    (cd "$control_dir" && tar $TAR_OPTS -czf "$pkg_dir/control.tar.gz" ./)
    (cd "$data_dir" && tar $TAR_OPTS -czf "$pkg_dir/data.tar.gz" ./)
    (cd "$pkg_dir" && tar $TAR_OPTS -czf "$output" debian-binary control.tar.gz data.tar.gz)

    echo "  -> $(basename "$output")"
}

# ============================================================
# Single package: luci-app-open-cc-switch (binary + LuCI)
# ============================================================
echo "=== Building ${PKG_NAME}_${VERSION}-${PKG_RELEASE}_${OPKG_ARCH}.ipk ==="

if [ ! -f "$BINARY" ]; then
    echo "ERROR: Binary not found at $BINARY"
    echo "Cross-compile first:"
    echo "  cd proxy-daemon && cargo build --release --target $RUST_TARGET"
    exit 1
fi

# Control
CONTROL="$WORK_DIR/control"
mkdir -p "$CONTROL"
cat > "$CONTROL/control" <<EOF
Package: ${PKG_NAME}
Version: ${VERSION}-${PKG_RELEASE}
Depends: libc, luci-base
Section: luci
Architecture: ${OPKG_ARCH}
Maintainer: kuno <noreply@github.com>
Description: Open CC Switch - AI API Proxy for OpenWrt
 AI API proxy daemon with LuCI web interface. Provides provider routing,
 failover, request optimization, and outbound proxy configuration.
EOF

cat > "$CONTROL/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
    chmod +x /usr/bin/cc-switch 2>/dev/null
    /etc/init.d/rpcd restart
    /etc/init.d/uhttpd restart
}
exit 0
EOF
chmod 755 "$CONTROL/postinst"

cat > "$CONTROL/prerm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
    /etc/init.d/ccswitch disable 2>/dev/null
    /etc/init.d/ccswitch stop 2>/dev/null
}
exit 0
EOF
chmod 755 "$CONTROL/prerm"

cat > "$CONTROL/conffiles" <<EOF
/etc/config/ccswitch
EOF

# Data — binary + LuCI files
DATA="$WORK_DIR/data"

# Binary
mkdir -p "$DATA/usr/bin"
cp "$BINARY" "$DATA/usr/bin/cc-switch"
chmod 755 "$DATA/usr/bin/cc-switch"

# Config and init script
mkdir -p "$DATA/etc/config"
mkdir -p "$DATA/etc/init.d"
cp "$LUCI_SRC/root/etc/config/ccswitch"    "$DATA/etc/config/"
cp "$LUCI_SRC/root/etc/init.d/ccswitch"    "$DATA/etc/init.d/"
chmod 755                                   "$DATA/etc/init.d/ccswitch"

# LuCI files
mkdir -p "$DATA/usr/share/rpcd/acl.d"
mkdir -p "$DATA/usr/share/luci/menu.d"
mkdir -p "$DATA/www/luci-static/resources/view/ccswitch"
cp "$LUCI_SRC/root/usr/share/rpcd/acl.d/luci-app-ccswitch.json"  "$DATA/usr/share/rpcd/acl.d/"
cp "$LUCI_SRC/root/usr/share/luci/menu.d/luci-app-ccswitch.json" "$DATA/usr/share/luci/menu.d/"
cp "$LUCI_SRC/htdocs/luci-static/resources/view/ccswitch/settings.js" \
    "$DATA/www/luci-static/resources/view/ccswitch/"

build_ipk "$CONTROL" "$DATA" \
    "$DIST_DIR/${PKG_NAME}_${VERSION}-${PKG_RELEASE}_${OPKG_ARCH}.ipk"

# Clean up
rm -rf "$WORK_DIR"

echo ""
echo "Done! Package in $DIST_DIR/"
ls -lh "$DIST_DIR/"
echo ""
echo "Install on router:"
echo "  scp $DIST_DIR/${PKG_NAME}_${VERSION}-${PKG_RELEASE}_${OPKG_ARCH}.ipk root@<router-ip>:/tmp/"
echo "  ssh root@<router-ip>"
echo "  opkg install /tmp/${PKG_NAME}_${VERSION}-${PKG_RELEASE}_${OPKG_ARCH}.ipk"
