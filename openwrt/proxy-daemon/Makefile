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
