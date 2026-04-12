include $(TOPDIR)/rules.mk

PKG_NAME:=cc-switch
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_MAINTAINER:=kuno <noreply@github.com>

include $(INCLUDE_DIR)/package.mk

define Package/cc-switch
  SECTION:=net
  CATEGORY:=Network
  TITLE:=CC Switch AI API Proxy Daemon
  URL:=https://github.com/kuno/open-cc-switch
endef

define Package/cc-switch/description
  A lightweight AI API proxy daemon that provides provider routing,
  failover, and request optimization for LLM API traffic.
endef

define Package/cc-switch/conffiles
/etc/config/ccswitch
endef

define Package/cc-switch/postinst
#!/bin/sh
STATE_FILE="/var/run/ccswitch.enabled-before-upgrade"
[ -n "$${IPKG_INSTROOT}" ] || {
	chmod 0755 /usr/bin/cc-switch 2>/dev/null || true
	chmod 0755 /etc/init.d/ccswitch 2>/dev/null || true
	if [ -f "$$STATE_FILE" ]; then
		rm -f "$$STATE_FILE"
		/etc/init.d/ccswitch enable >/dev/null 2>&1 || true
		/etc/init.d/ccswitch restart >/dev/null 2>&1 || true
	fi
}
exit 0
endef

define Package/cc-switch/prerm
#!/bin/sh
STATE_FILE="/var/run/ccswitch.enabled-before-upgrade"
[ -n "$${IPKG_INSTROOT}" ] || {
	if /etc/init.d/ccswitch enabled >/dev/null 2>&1; then
		mkdir -p "$${STATE_FILE%/*}"
		: > "$$STATE_FILE"
	else
		rm -f "$$STATE_FILE"
	fi
}
exit 0
endef

define Package/cc-switch/postrm
#!/bin/sh
STATE_FILE="/var/run/ccswitch.enabled-before-upgrade"
[ -n "$${IPKG_INSTROOT}" ] || rm -f "$$STATE_FILE"
exit 0
endef

# Skip source compile — we use a pre-built static binary.
# Cross-compile the binary before packaging:
#   cd proxy-daemon && cargo build --release --target aarch64-unknown-linux-musl
# Then place the binary at ./files/cc-switch

define Build/Compile
endef

define Package/cc-switch/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/etc/config $(1)/etc/init.d
	$(INSTALL_BIN) ./files/cc-switch $(1)/usr/bin/cc-switch
	$(INSTALL_CONF) ./files/etc/config/ccswitch $(1)/etc/config/ccswitch
	$(INSTALL_BIN) ./files/etc/init.d/ccswitch $(1)/etc/init.d/ccswitch
endef

$(eval $(call BuildPackage,cc-switch))
