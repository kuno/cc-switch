# CC Switch for OpenWrt

This directory contains split OpenWrt packaging for:

- `cc-switch`: the daemon, init script, and UCI config
- `luci-app-cc-switch`: the LuCI UI plus rpcd ACL/ucode integration

The split package layout is the same in both the feed metadata and the
standalone `build-ipk.sh` path, including package lifecycle hooks.

## Package layout

`cc-switch` installs:

- `/usr/bin/cc-switch`
- `/etc/init.d/ccswitch`
- `/etc/config/ccswitch`

`luci-app-cc-switch` installs:

- `/usr/share/rpcd/acl.d/luci-app-ccswitch.json`
- `/usr/share/rpcd/ucode/ccswitch`
- `/usr/share/luci/menu.d/luci-app-ccswitch.json`
- `/www/luci-static/resources/view/ccswitch/settings.js`

## Build without the OpenWrt SDK

Build a statically linked musl binary first:

```bash
rustup target add aarch64-unknown-linux-musl

cd proxy-daemon
cargo build --release --target aarch64-unknown-linux-musl
```

Then build the IPKs:

```bash
./openwrt/build-ipk.sh aarch64
```

By default, the standalone builder derives the package version from
`git describe --tags --match 'v[0-9]*' --always --dirty` so the generated
`.ipk` filenames and embedded control metadata match the current branch state
relative to product tags. OpenWrt release tags such as `openwrt-v*` are ignored
by version derivation. Use `--version` only when you need to override that
derived version explicitly.

This produces:

- `openwrt/dist/cc-switch_<git-describe>-1_aarch64_generic.ipk`
- `openwrt/dist/luci-app-cc-switch_<git-describe>-1_all.ipk`

Built-in target aliases:

- `aarch64` -> `aarch64-unknown-linux-musl` / `aarch64_generic`
- `x86_64` -> `x86_64-unknown-linux-musl` / `x86_64`

For other OpenWrt targets, pass both the Rust target triple and the opkg
architecture explicitly:

```bash
./openwrt/build-ipk.sh \
  --rust-target <rust-target-triple> \
  --opkg-arch <openwrt-opkg-arch>
```

The standalone builder rejects non-static binaries so the manual install path
does not silently miss shared-library dependencies.

## Build with the OpenWrt SDK or buildroot

The feed packages live here:

- `openwrt/proxy-daemon/`
- `openwrt/luci-app-ccswitch/`

The feed Makefiles also define the package maintainer hooks used for live
install, upgrade, and removal:

- `Package/cc-switch/{postinst,prerm,postrm}`
- `Package/luci-app-cc-switch/{postinst,postrm}`

Before running the OpenWrt package build, place the prebuilt daemon binary at:

```bash
openwrt/proxy-daemon/files/cc-switch
```

That package directory also owns the init/config templates under
`openwrt/proxy-daemon/files/etc/`.

The standalone builder mirrors the same lifecycle behavior by emitting the
OpenWrt-style control-script split directly into the `.ipk` archives:

- `postinst` wrapper plus `postinst-pkg`
- `prerm` wrapper plus `prerm-pkg`
- `postrm` where needed

## Install on a router

```bash
ROUTER=root@192.168.1.1

scp openwrt/dist/cc-switch_0.2.0-1_aarch64_generic.ipk \
    openwrt/dist/luci-app-cc-switch_0.2.0-1_all.ipk \
    $ROUTER:/tmp/

ssh $ROUTER opkg install \
  /tmp/cc-switch_0.2.0-1_aarch64_generic.ipk \
  /tmp/luci-app-cc-switch_0.2.0-1_all.ipk
```

Live install and removal behavior:

- on first install, `cc-switch` follows the normal OpenWrt init-script flow and enables the service at boot; runtime start still depends on `ccswitch.main.enabled=1`
- on upgrade or replacement, `cc-switch` remembers whether the init script was enabled before `prerm` and restores that enablement in `postinst`
- on final removal, `cc-switch` disables the init script, stops the service, and clears its temporary upgrade-state marker
- `/etc/config/ccswitch` is packaged as a conffile and is preserved across upgrades
- `luci-app-cc-switch` refreshes rpcd, uhttpd, and LuCI caches on install and removal
- runtime data under `/etc/cc-switch` is left in place on package removal

## Enable and start the service

```bash
ssh $ROUTER uci set ccswitch.main.enabled=1
ssh $ROUTER uci set ccswitch.main.https_proxy=http://127.0.0.1:7890
ssh $ROUTER uci commit ccswitch
ssh $ROUTER /etc/init.d/ccswitch enable
ssh $ROUTER /etc/init.d/ccswitch restart
```

The init script uses procd and treats config reload as a full restart because
the daemon consumes listen/proxy/log settings from process environment at
startup.

## Maintenance backups

The OpenWrt admin API exposes backend-only maintenance endpoints for daemon
state under the configured data directory (`/etc/cc-switch` from the packaged
init script):

- `GET /openwrt/admin/backups` lists managed database backups with size,
  timestamp, schema metadata, daemon version, and scope.
- `POST /openwrt/admin/backups` creates a new `cc-switch.db` snapshot under
  `/etc/cc-switch/backups`.
- `GET /openwrt/admin/backups/<filename>/download` downloads a managed backup.
- `POST /openwrt/admin/backups/import` imports a base64-encoded SQLite backup
  into the managed backup directory without accepting raw filesystem paths.
- `POST /openwrt/admin/backups/<filename>/restore` restores a managed backup
  after first creating a safety backup of the current database.
- `DELETE /openwrt/admin/backups/<filename>` deletes a managed backup.

These endpoints intentionally do not restore `/etc/config/ccswitch`. The UCI
file is OpenWrt-owned configuration and remains separate from daemon runtime
data; this maintenance slice backs up and restores the daemon database/data-dir
state first.

## Whole-app configuration archives

The Daemon card Backup & restore row uses separate whole-app archive endpoints:

- `GET /openwrt/admin/backup` downloads `application/gzip` as
  `ccswitch-backup-YYYY-MM-DD.tar.gz`.
- `POST /openwrt/admin/restore?dryRun=1` accepts multipart field `archive`,
  validates the tar.gz server-side, and returns `{ manifest }` without writing.
- `POST /openwrt/admin/restore` accepts multipart field `archive`, starts a
  restore job, and returns `202 { jobId }`.
- `GET /openwrt/admin/restore/jobs/<jobId>` returns the latest JSON event, or
  streams JSON SSE events when `Accept: text/event-stream` is sent.

Archive entries are `manifest.json`, `etc/config/ccswitch`,
`data/cc-switch.db`, and top-level provider auth files under
`data/codex_auth/*.json` and `data/claude_auth/*.json`. The database entry is
a consistent SQLite snapshot created through SQLite's backup API rather than a
raw copy of the live file. Restore validates regular-file tar entries only,
rejects traversal and unsupported paths, validates UCI syntax when `uci` is
available, restores the database through SQLite's backup API, writes
config/auth through temporary files, clears managed auth dirs before applying
archive auth files, reloads daemon settings in-process, and verifies the
applied config/auth files plus database schema readability. Older
config/auth-only archives remain accepted for compatibility, but new archives
report `backupScope: "full-app"` and `databaseIncluded: true` in the manifest.
The manifest reports `rollbackSupported: false`; failed apply/verify paths
still attempt best-effort local file rollback, but the API does not promise
automatic transactional rollback.

## LuCI

Open the LuCI page at:

```text
http://192.168.1.1/cgi-bin/luci/admin/services/ccswitch
```

After saving provider settings in LuCI, restart the service if it is already
running.

LAN clients can point to the router with:

```bash
export ANTHROPIC_BASE_URL=http://192.168.1.1:15721
```
