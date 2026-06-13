#!/bin/sh

set -eu

APP_NAME="luci-app-byedpi"
REPO_URL="${REPO_URL:-https://github.com/moz9/luci-app-byedpi}"
REF="${REF:-main}"
ARCHIVE_URL="${ARCHIVE_URL:-${REPO_URL%/}/archive/refs/heads/${REF}.tar.gz}"
BYEDPI_AUTO_INSTALL="${BYEDPI_AUTO_INSTALL:-1}"
BYEDPI_START="${BYEDPI_START:-1}"
BYEDPI_RELEASE_API="${BYEDPI_RELEASE_API:-https://api.github.com/repos/DPITrickster/ByeDPI-OpenWrt/releases/latest}"
PODKOP_CONFIGURE="${PODKOP_CONFIGURE:-1}"
PODKOP_SECTION="${PODKOP_SECTION:-byedpi}"
PODKOP_PROXY_STRING="${PODKOP_PROXY_STRING:-socks5://127.0.0.1:1080#byedpi}"
PODKOP_RESOLVE_REAL_IP="${PODKOP_RESOLVE_REAL_IP:-1}"
PODKOP_RESTART="${PODKOP_RESTART:-1}"
STATE_DIR="/etc/luci-app-byedpi"
STATE_FILE="$STATE_DIR/install.state"
WORK_DIR="${TMPDIR:-/tmp}/${APP_NAME}.$$"

die() {
	echo "ERROR: $*" >&2
	exit 1
}

info() {
	echo "==> $*" >&2
}

have() {
	command -v "$1" >/dev/null 2>&1
}

download() {
	local url="$1" target="$2"

	if have curl; then
		curl -fsSL "$url" -o "$target"
	elif have wget; then
		wget -qO "$target" "$url"
	else
		die "curl or wget is required to download ${APP_NAME}"
	fi
}

cleanup() {
	rm -rf "$WORK_DIR"
}

find_local_source() {
	local script_dir

	script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)"
	if [ -f "$script_dir/root/usr/libexec/byedpi-luci" ] && [ -d "$script_dir/htdocs/luci-static" ]; then
		printf '%s\n' "$script_dir"
		return 0
	fi

	return 1
}

fetch_source() {
	local archive="$WORK_DIR/source.tar.gz" source_dir

	mkdir -p "$WORK_DIR"
	info "Downloading ${ARCHIVE_URL}"
	download "$ARCHIVE_URL" "$archive"
	tar -xzf "$archive" -C "$WORK_DIR"

	source_dir="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
	[ -n "$source_dir" ] || die "Downloaded archive does not contain a source directory"
	[ -f "$source_dir/root/usr/libexec/byedpi-luci" ] || die "Downloaded archive is not ${APP_NAME}"

	printf '%s\n' "$source_dir"
}

check_openwrt() {
	[ "$(id -u)" = "0" ] || die "Run this installer as root on OpenWrt"
	[ -f /etc/openwrt_release ] || die "This installer is intended for OpenWrt"
	have uci || die "uci is required"
	have jsonfilter || die "jsonfilter is required; install luci-base"
	[ -f /usr/share/libubox/jshn.sh ] || die "jshn.sh is required; install libubox/luci-base"
	[ -d /www/luci-static/resources ] || die "LuCI static directory was not found; install luci-base"
}

has_byedpi() {
	[ -x /usr/bin/ciadpi ] && [ -x /etc/init.d/byedpi ]
}

bool_status() {
	"$@" >/dev/null 2>&1 && printf '%s\n' 1 || printf '%s\n' 0
}

init_state() {
	[ -f "$STATE_FILE" ] && return 0

	mkdir -p "$STATE_DIR"
	{
		printf 'byedpi_was_installed=%s\n' "$(bool_status has_byedpi)"
		if [ -x /etc/init.d/byedpi ]; then
			printf 'byedpi_was_enabled=%s\n' "$(bool_status /etc/init.d/byedpi enabled)"
			printf 'byedpi_was_running=%s\n' "$(bool_status /etc/init.d/byedpi status)"
		else
			printf 'byedpi_was_enabled=0\n'
			printf 'byedpi_was_running=0\n'
		fi
		if [ -f /etc/config/podkop ] && uci -q get "podkop.$PODKOP_SECTION" >/dev/null 2>&1; then
			printf 'podkop_section_existed=1\n'
		else
			printf 'podkop_section_existed=0\n'
		fi
		printf 'podkop_section=%s\n' "$PODKOP_SECTION"
		printf 'byedpi_installed_by_installer=0\n'
		printf 'podkop_section_created_by_installer=0\n'
	} > "$STATE_FILE"
}

set_state() {
	local key="$1" value="$2" tmp="$STATE_FILE.tmp"

	mkdir -p "$STATE_DIR"
	if [ -f "$STATE_FILE" ]; then
		grep -v "^${key}=" "$STATE_FILE" > "$tmp" || true
	else
		: > "$tmp"
	fi
	printf '%s=%s\n' "$key" "$value" >> "$tmp"
	mv "$tmp" "$STATE_FILE"
}

byedpi_package_arch() {
	local arch

	arch="$(awk -F"'" '/DISTRIB_ARCH/ {print $2}' /etc/openwrt_release 2>/dev/null || true)"

	if [ -z "${arch:-}" ]; then
		arch="$(apk --print-arch 2>/dev/null || true)"
	fi

	[ -n "$arch" ] || die "Could not detect OpenWrt package architecture"
	printf '%s\n' "$arch"
}

byedpi_package_ext() {
	if have apk; then
		printf '%s\n' "apk"
	elif have opkg; then
		printf '%s\n' "ipk"
	else
		die "apk or opkg package manager is required to install ByeDPI"
	fi
}

find_byedpi_package_url() {
	local arch="$1" ext="$2" release_json="$WORK_DIR/byedpi-release.json"

	mkdir -p "$WORK_DIR"
	info "Looking for ByeDPI package: arch=${arch}, format=${ext}"
	download "$BYEDPI_RELEASE_API" "$release_json"

	sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$release_json" |
		grep -F "_${arch}.${ext}" |
		head -n 1
}

install_byedpi_package() {
	local package="$1" ext="$2"

	case "$ext" in
		apk)
			apk add --allow-untrusted "$package"
			;;
		ipk)
			opkg install "$package"
			;;
		*)
			die "Unsupported ByeDPI package format: $ext"
			;;
	esac
}

start_byedpi_service() {
	[ "$BYEDPI_START" = "1" ] || {
		info "Skipping ByeDPI service start"
		return 0
	}

	[ -x /etc/init.d/byedpi ] || return 0
	/etc/init.d/byedpi enable >/dev/null 2>&1 || true
	/etc/init.d/byedpi restart >/dev/null 2>&1 || true
	info "Started ByeDPI service"
}

normalize_byedpi_config() {
	local cmd_opts legacy_opts

	uci -q get byedpi.main >/dev/null 2>&1 || uci set byedpi.main=byedpi
	uci -q get byedpi.main.enabled >/dev/null 2>&1 || uci set byedpi.main.enabled="1"

	cmd_opts="$(uci -q get byedpi.main.cmd_opts || true)"
	legacy_opts="$(uci -q get byedpi.main.options || true)"

	if [ -z "$cmd_opts" ] && [ -n "$legacy_opts" ]; then
		uci set byedpi.main.cmd_opts="$legacy_opts"
	elif [ -n "$cmd_opts" ] && [ -z "$legacy_opts" ]; then
		uci set byedpi.main.options="$cmd_opts"
	fi

	uci commit byedpi
}

ensure_byedpi() {
	local arch ext url package

	if has_byedpi; then
		info "ByeDPI is already installed"
		normalize_byedpi_config
		start_byedpi_service
		return 0
	fi

	[ "$BYEDPI_AUTO_INSTALL" = "1" ] || die "ByeDPI is not installed. Set BYEDPI_AUTO_INSTALL=1 or install ByeDPI first."

	arch="$(byedpi_package_arch)"
	ext="$(byedpi_package_ext)"
	url="$(find_byedpi_package_url "$arch" "$ext")"
	[ -n "$url" ] || die "Could not find ByeDPI ${ext} package for architecture ${arch}"

	package="$WORK_DIR/$(basename "$url")"
	info "Downloading ByeDPI: $url"
	download "$url" "$package"

	info "Installing ByeDPI"
	install_byedpi_package "$package" "$ext"
	set_state byedpi_installed_by_installer 1

	has_byedpi || die "ByeDPI package was installed, but /usr/bin/ciadpi or /etc/init.d/byedpi is still missing"
	normalize_byedpi_config
	start_byedpi_service
}

configure_podkop_byedpi() {
	local exists=0

	[ "$PODKOP_CONFIGURE" = "1" ] || {
		info "Skipping Podkop integration"
		return 0
	}

	if [ ! -f /etc/config/podkop ]; then
		info "Podkop config was not found, skipping Podkop integration"
		return 0
	fi

	if uci -q get "podkop.$PODKOP_SECTION" >/dev/null 2>&1; then
		exists=1
	fi

	if [ "$exists" = "1" ]; then
		info "Normalizing Podkop section '$PODKOP_SECTION'"
	else
		info "Creating Podkop section '$PODKOP_SECTION'"
	fi

	uci set "podkop.$PODKOP_SECTION=section"
	uci set "podkop.$PODKOP_SECTION.connection_type=proxy"
	uci set "podkop.$PODKOP_SECTION.proxy_config_type=url"
	uci set "podkop.$PODKOP_SECTION.proxy_string=$PODKOP_PROXY_STRING"
	uci set "podkop.$PODKOP_SECTION.resolve_real_ip_for_routing=$PODKOP_RESOLVE_REAL_IP"
	uci set "podkop.$PODKOP_SECTION.user_domain_list_type=disabled"
	uci set "podkop.$PODKOP_SECTION.user_subnet_list_type=disabled"
	uci set "podkop.$PODKOP_SECTION.mixed_proxy_enabled=0"
	uci set "podkop.$PODKOP_SECTION.enable_udp_over_tcp=0"

	uci commit podkop
	[ "$exists" = "0" ] && set_state podkop_section_created_by_installer 1

	if [ "$PODKOP_RESTART" = "1" ] && [ -x /etc/init.d/podkop ]; then
		/etc/init.d/podkop restart >/dev/null 2>&1 || true
	fi

	info "Configured Podkop section '$PODKOP_SECTION'"
}

install_files() {
	local src="$1"

	info "Installing LuCI files"
	mkdir -p /www /usr/libexec /usr/share/luci/menu.d /usr/share/rpcd/acl.d /usr/share/byedpi-luci
	cp -R "$src/htdocs/." /www/
	cp -R "$src/root/." /

	chmod 0755 /usr/libexec/byedpi-luci
	chmod 0755 /etc/uci-defaults/50_luci-byedpi
	/etc/uci-defaults/50_luci-byedpi || true
}

reload_luci() {
	info "Refreshing LuCI"
	rm -f /tmp/luci-indexcache* /var/luci-indexcache* 2>/dev/null || true
	[ -x /etc/init.d/rpcd ] && (/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true)
	[ -x /etc/init.d/uhttpd ] && (/etc/init.d/uhttpd reload >/dev/null 2>&1 || /etc/init.d/uhttpd restart >/dev/null 2>&1 || true)
}

main() {
	local src

	trap cleanup EXIT INT TERM
	check_openwrt
	init_state

	if [ "${SKIP_BYEDPI_CHECK:-0}" != "1" ]; then
		ensure_byedpi
	fi
	configure_podkop_byedpi

	if src="$(find_local_source)"; then
		info "Using local source: $src"
	else
		src="$(fetch_source)"
	fi

	install_files "$src"
	reload_luci

	info "Installed ${APP_NAME}"
	echo "Open LuCI: Services -> ByeDPI"
	echo "Direct URL: /cgi-bin/luci/admin/services/byedpi"
}

main "$@"
