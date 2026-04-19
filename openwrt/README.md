# CC Switch for OpenWrt

LuCI app + `cc-switch` daemon package for OpenWrt.

## Quick Start (manual install without OpenWrt SDK)

### 1. Cross-compile cc-switch

```bash
cd proxy-daemon
cargo build --release --target aarch64-unknown-linux-musl
```

### 2. Copy files to router

```bash
ROUTER=root@192.168.1.1

# Binary
scp proxy-daemon/target/aarch64-unknown-linux-musl/release/cc-switch $ROUTER:/usr/bin/
ssh $ROUTER chmod +x /usr/bin/cc-switch

# UCI config
scp openwrt/luci-app-ccswitch/root/etc/config/ccswitch $ROUTER:/etc/config/

# Init script
scp openwrt/luci-app-ccswitch/root/etc/init.d/ccswitch $ROUTER:/etc/init.d/
ssh $ROUTER chmod +x /etc/init.d/ccswitch

# LuCI files
scp openwrt/luci-app-ccswitch/root/usr/share/rpcd/acl.d/luci-app-ccswitch.json $ROUTER:/usr/share/rpcd/acl.d/
scp openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch $ROUTER:/usr/share/rpcd/ucode/
scp openwrt/luci-app-ccswitch/root/usr/share/luci/menu.d/luci-app-ccswitch.json $ROUTER:/usr/share/luci/menu.d/
scp openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js $ROUTER:/www/luci-static/resources/view/ccswitch/

# Restart rpcd and uhttpd to pick up new files
ssh $ROUTER /etc/init.d/rpcd restart
ssh $ROUTER /etc/init.d/uhttpd restart
```

### 3. Enable and start

```bash
ssh $ROUTER uci set ccswitch.main.enabled=1
ssh $ROUTER uci set ccswitch.main.https_proxy=http://127.0.0.1:7890
ssh $ROUTER uci commit ccswitch
ssh $ROUTER /etc/init.d/ccswitch enable
ssh $ROUTER /etc/init.d/ccswitch start
```

### 4. Configure the Claude provider in LuCI

Open `http://192.168.1.1/cgi-bin/luci/admin/services/ccswitch`, save one Claude-compatible
provider, then restart the service from the same page if it is already running.

### 5. Configure AI clients

On LAN machines, point AI tools at the router:

```bash
export ANTHROPIC_BASE_URL=http://192.168.1.1:15721
```

The LuCI web UI is at: http://192.168.1.1/cgi-bin/luci/admin/services/ccswitch
