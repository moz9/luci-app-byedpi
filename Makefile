include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-byedpi
PKG_VERSION:=0.2.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI app for ByeDPI
LUCI_DEPENDS:=+luci-base +byedpi +curl +ca-bundle
LUCI_PKGARCH:=all

PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=moz9

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)$(HTDOCS)
	$(CP) $(PKG_BUILD_DIR)/htdocs/* $(1)$(HTDOCS)/
	$(INSTALL_DIR) $(1)/
	$(CP) $(PKG_BUILD_DIR)/root/* $(1)/
	chmod 0755 $(1)/usr/libexec/byedpi-luci
	chmod 0755 $(1)/usr/libexec/byedpi-luci-test
	chmod 0755 $(1)/etc/uci-defaults/50_luci-byedpi
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
