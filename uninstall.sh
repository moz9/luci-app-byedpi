#!/bin/sh

set -u

info() {
	echo "==> $*"
}

[ "$(id -u)" = "0" ] || {
	echo "ERROR: Run this script as root on OpenWrt" >&2
	exit 1
}

info "Removing luci-app-byedpi files"
rm -f /usr/libexec/byedpi-luci
rm -f /usr/share/luci/menu.d/luci-app-byedpi.json
rm -f /usr/share/rpcd/acl.d/luci-app-byedpi.json
rm -f /etc/uci-defaults/50_luci-byedpi
rm -f /www/luci-static/resources/view/byedpi/main.js
rm -f /www/luci-static/resources/view/byedpi/byedpi.js
rm -rf /usr/share/byedpi-luci
rm -rf /tmp/byedpi-luci-test.lock

rmdir /www/luci-static/resources/view/byedpi 2>/dev/null || true

info "Refreshing LuCI"
rm -f /tmp/luci-indexcache* /var/luci-indexcache* 2>/dev/null || true
[ -x /etc/init.d/rpcd ] && (/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true)
[ -x /etc/init.d/uhttpd ] && (/etc/init.d/uhttpd reload >/dev/null 2>&1 || /etc/init.d/uhttpd restart >/dev/null 2>&1 || true)

info "Removed luci-app-byedpi"
echo "ByeDPI, Podkop, and /etc/config/byedpi were not modified."
