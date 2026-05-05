include $(TOPDIR)/rules.mk

CCSWITCH_THIS_MAKEFILE:=$(lastword $(MAKEFILE_LIST))
CCSWITCH_LUCI_PKG_DIR:=$(patsubst %/,%,$(dir $(abspath $(CCSWITCH_THIS_MAKEFILE))))
CCSWITCH_OPENWRT_DIR:=$(CCSWITCH_LUCI_PKG_DIR)/..
CCSWITCH_PROVIDER_UI_DIR:=$(CCSWITCH_LUCI_PKG_DIR)/htdocs/luci-static/resources/ccswitch/provider-ui
CCSWITCH_PREPARE_PROVIDER_UI:=$(CCSWITCH_OPENWRT_DIR)/prepare-provider-ui-bundle.sh
CCSWITCH_LUCI_I18N_BUILD_DIR=$(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n

PKG_NAME:=luci-app-cc-switch
PKG_VERSION:=0.2.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_MAINTAINER:=kuno <noreply@github.com>

LUCI_TITLE:=LuCI support for CC Switch
LUCI_DEPENDS:=+cc-switch +curl +luci-base +rpcd-mod-ucode
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

define Build/Compile
	$(SHELL) $(CCSWITCH_PREPARE_PROVIDER_UI) --output-dir "$(CCSWITCH_PROVIDER_UI_DIR)"
	rm -rf "$(CCSWITCH_LUCI_I18N_BUILD_DIR)"
	mkdir -p "$(CCSWITCH_LUCI_I18N_BUILD_DIR)"
	if [ -d "$(CCSWITCH_LUCI_PKG_DIR)/po" ]; then \
		$(FIND) "$(CCSWITCH_LUCI_PKG_DIR)/po" -name '*.po' | while read f; do \
			lang=$$(basename "$$(dirname "$$f")"); \
			pkg=$$(basename "$$f" .po); \
			po2lmo "$$f" "$(CCSWITCH_LUCI_I18N_BUILD_DIR)/$$pkg.$$lang.lmo" || exit 1; \
		done; \
	fi
endef

define Package/luci-app-cc-switch/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/*
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	/etc/init.d/uhttpd reload >/dev/null 2>&1 || /etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-app-cc-switch/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/*
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	/etc/init.d/uhttpd reload >/dev/null 2>&1 || /etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
