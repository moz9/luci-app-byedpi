#!/bin/sh

set -u

STATE_DIR="/etc/luci-app-byedpi"
STATE_FILE="$STATE_DIR/install.state"

info() {
	echo "==> $*"
}

[ "$(id -u)" = "0" ] || {
	echo "ERROR: Run this script as root on OpenWrt" >&2
	exit 1
}

has_state=0
[ -f "$STATE_FILE" ] && has_state=1

state_get() {
	local key="$1"

	[ -f "$STATE_FILE" ] || return 1
	grep "^${key}=" "$STATE_FILE" | tail -n 1 | cut -d= -f2-
}

remove_byedpi_package() {
	if command -v apk >/dev/null 2>&1; then
		apk del byedpi >/dev/null 2>&1 || true
	elif command -v opkg >/dev/null 2>&1; then
		opkg remove byedpi >/dev/null 2>&1 || true
	fi
}

restore_byedpi_service_state() {
	local was_enabled="$1" was_running="$2"

	[ -x /etc/init.d/byedpi ] || return 0

	if [ "$was_enabled" = "1" ]; then
		/etc/init.d/byedpi enable >/dev/null 2>&1 || true
	else
		/etc/init.d/byedpi disable >/dev/null 2>&1 || true
	fi

	if [ "$was_running" = "1" ]; then
		/etc/init.d/byedpi start >/dev/null 2>&1 || true
	else
		/etc/init.d/byedpi stop >/dev/null 2>&1 || true
	fi
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

podkop_section="$(state_get podkop_section 2>/dev/null || echo byedpi)"
podkop_created="$(state_get podkop_section_created_by_installer 2>/dev/null || echo 0)"
byedpi_installed="$(state_get byedpi_installed_by_installer 2>/dev/null || echo 0)"
byedpi_was_enabled="$(state_get byedpi_was_enabled 2>/dev/null || echo 0)"
byedpi_was_running="$(state_get byedpi_was_running 2>/dev/null || echo 0)"

if [ "$podkop_created" = "1" ] || [ "${REMOVE_PODKOP_BYEDPI:-0}" = "1" ]; then
	info "Removing Podkop section '$podkop_section'"
	uci -q delete "podkop.$podkop_section" || true
	uci commit podkop 2>/dev/null || true
	if [ -x /etc/init.d/podkop ]; then
		/etc/init.d/podkop restart >/dev/null 2>&1 || true
	fi
fi

if [ "$byedpi_installed" = "1" ] || [ "${REMOVE_BYEDPI:-0}" = "1" ]; then
	info "Removing ByeDPI package"
	/etc/init.d/byedpi stop >/dev/null 2>&1 || true
	remove_byedpi_package
elif [ "$has_state" = "1" ]; then
	restore_byedpi_service_state "$byedpi_was_enabled" "$byedpi_was_running"
else
	info "No install state found, leaving ByeDPI service unchanged"
fi

info "Refreshing LuCI"
rm -f /tmp/luci-indexcache* /var/luci-indexcache* 2>/dev/null || true
[ -x /etc/init.d/rpcd ] && (/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true)
[ -x /etc/init.d/uhttpd ] && (/etc/init.d/uhttpd reload >/dev/null 2>&1 || /etc/init.d/uhttpd restart >/dev/null 2>&1 || true)

[ "$has_state" = "1" ] && rm -rf "$STATE_DIR"

info "Removed luci-app-byedpi"
echo "Created Podkop/ByeDPI changes were reverted when install state allowed it."
