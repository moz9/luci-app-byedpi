#!/bin/sh

set -eu

APP_NAME="luci-app-byedpi"
REPO_URL="${REPO_URL:-https://github.com/moz9/luci-app-byedpi}"
REF="${REF:-main}"
ARCHIVE_URL="${ARCHIVE_URL:-${REPO_URL%/}/archive/refs/heads/${REF}.tar.gz}"
BYEDPI_AUTO_INSTALL="${BYEDPI_AUTO_INSTALL:-1}"
BYEDPI_START="${BYEDPI_START:-auto}"
BYEDPI_RELEASE_API="${BYEDPI_RELEASE_API:-https://api.github.com/repos/DPITrickster/ByeDPI-OpenWrt/releases/latest}"
PODKOP_CONFIGURE="${PODKOP_CONFIGURE:-1}"
PODKOP_SECTION="${PODKOP_SECTION:-byedpi}"
PODKOP_PROXY_STRING="${PODKOP_PROXY_STRING:-socks5://127.0.0.1:1080#byedpi}"
PODKOP_RESOLVE_REAL_IP="${PODKOP_RESOLVE_REAL_IP:-1}"
PODKOP_RESTART="${PODKOP_RESTART:-1}"
STATE_DIR="/etc/luci-app-byedpi"
STATE_FILE="$STATE_DIR/install.state"
WORK_DIR="${TMPDIR:-/tmp}/${APP_NAME}.$$"
MUTATING=0
COMPLETE=0
PODKOP_CHANGED=0
SERVICE_CHANGED=0
INSTALL_LOCKED=0
TEST_START_LOCK="/tmp/byedpi-luci-test-v2.start"
INSTALL_PATHS="/etc/config/byedpi
/etc/config/podkop
/etc/luci-app-byedpi/install.state
/etc/uci-defaults/50_luci-byedpi
/usr/libexec/byedpi-luci
/usr/libexec/byedpi-luci-test
/usr/share/luci/menu.d/luci-app-byedpi.json
/usr/share/rpcd/acl.d/luci-app-byedpi.json
/usr/share/byedpi-luci/strategies.txt
/usr/share/byedpi-luci/domains.txt
/usr/share/byedpi-luci/proxytest.results
/usr/share/byedpi-luci/score.awk
/www/luci-static/resources/view/byedpi/main.js
/www/luci-static/resources/view/byedpi/byedpi.js"

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
		curl -fsSL --connect-timeout 15 --max-time 120 "$url" -o "$target"
	elif have wget; then
		wget -T 30 -qO "$target" "$url"
	else
		die "curl or wget is required to download ${APP_NAME}"
	fi
}

cleanup() {
	local rc=$?
	trap - 0 INT TERM
	set +e
	if [ "$MUTATING" = 1 ] && [ "$COMPLETE" != 1 ]; then
		info "Installation failed; restoring previous files and configuration"
		rollback_files || info "Automatic restore failed. Backup: $STATE_DIR/rollback.tar.gz"
		if [ "$SERVICE_CHANGED" = 1 ]; then
			if [ "$WAS_ENABLED" = 1 ]; then /etc/init.d/byedpi enable; else /etc/init.d/byedpi disable; fi
			if [ "$WAS_RUNNING" = 1 ]; then /etc/init.d/byedpi restart; else /etc/init.d/byedpi stop; fi
		fi
		[ "$PODKOP_CHANGED" != 1 ] || /etc/init.d/podkop restart
		reload_luci || true
		[ "$rc" != 0 ] || rc=1
	fi
	[ "$INSTALL_LOCKED" != 1 ] || rmdir "$TEST_START_LOCK"
	rm -rf "$WORK_DIR"
	exit "$rc"
}

backup_files() {
	local path
	umask 077
	mkdir -p "$WORK_DIR"
	: > "$WORK_DIR/existing.list"
	: > "$WORK_DIR/absent.list"
	for path in $INSTALL_PATHS; do
		if [ -e "$path" ]; then
			printf '%s\n' "${path#/}" >> "$WORK_DIR/existing.list"
		else
			printf '%s\n' "$path" >> "$WORK_DIR/absent.list"
		fi
	done
	tar -czf "$WORK_DIR/rollback.tar.gz" -C / -T "$WORK_DIR/existing.list"
	# Keep the last pre-install snapshot across reboots, without growing on each update.
	mkdir -p "$STATE_DIR"
	cp "$WORK_DIR/rollback.tar.gz" "$STATE_DIR/rollback.tar.gz"
	cp "$WORK_DIR/absent.list" "$STATE_DIR/rollback-absent.list"
	info "Backup: $STATE_DIR/rollback.tar.gz"
}

rollback_files() {
	local path
	# All paths come from the fixed file manifest above, never a downloaded command.
	while IFS= read -r path; do rm -f "$path"; done < "$WORK_DIR/absent.list"
	tar -xzf "$WORK_DIR/rollback.tar.gz" -C /
	uci -q revert byedpi || true
	uci -q revert podkop || true
}

ensure_test_dependencies() {
	local packages=""
	have curl || packages="curl"
	[ -s /etc/ssl/certs/ca-certificates.crt ] || packages="${packages:+$packages }ca-bundle"
	[ -n "$packages" ] || return 0
	info "Installing test dependencies: $packages"
	if have opkg; then
		opkg update || die "Could not update package lists"
		opkg install $packages || die "Could not install test dependencies"
	elif have apk; then
		apk add $packages || die "Could not install test dependencies"
	else
		die "Install curl and ca-bundle with your OpenWrt package manager"
	fi
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
	local existed="${1:-1}" tries=0
	if [ "$BYEDPI_START" = 0 ] || { [ "$BYEDPI_START" = auto ] && [ "$existed" = 1 ]; }; then
		info "Preserving ByeDPI runtime and autostart state"
		return 0
	fi
	SERVICE_CHANGED=1
	/etc/init.d/byedpi enable || die "Could not enable ByeDPI"
	/etc/init.d/byedpi start || die "Could not start ByeDPI"
	until /etc/init.d/byedpi status >/dev/null 2>&1; do
		tries=$((tries + 1))
		[ "$tries" -lt 10 ] || die "ByeDPI did not become ready"
		sleep 1
	done
	info "ByeDPI service is running"
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

	[ -z "$(uci -q changes byedpi || true)" ] || uci commit byedpi
}

ensure_byedpi() {
	local arch ext url package

	if has_byedpi; then
		info "ByeDPI is already installed"
		normalize_byedpi_config
		start_byedpi_service 1
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
	start_byedpi_service 0
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
		info "Preserving existing Podkop section '$PODKOP_SECTION'"
		return 0
	fi
	info "Creating Podkop section '$PODKOP_SECTION'"

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
		PODKOP_CHANGED=1
		/etc/init.d/podkop restart || die "Could not reload Podkop integration"
	fi

	info "Configured Podkop section '$PODKOP_SECTION'"
}

install_files() {
	local src="$1"

	info "Installing LuCI files"
	mkdir -p /www /usr/libexec /usr/share/luci/menu.d /usr/share/rpcd/acl.d /usr/share/byedpi-luci
	cp -R "$src/htdocs/." /www/
	cp -R "$src/root/." /

	chmod 0755 /www/luci-static/resources/view/byedpi /usr/share/byedpi-luci
	chmod 0644 /www/luci-static/resources/view/byedpi/main.js /www/luci-static/resources/view/byedpi/byedpi.js \
		/usr/share/byedpi-luci/strategies.txt /usr/share/byedpi-luci/domains.txt \
		/usr/share/byedpi-luci/proxytest.results /usr/share/byedpi-luci/score.awk \
		/usr/share/luci/menu.d/luci-app-byedpi.json /usr/share/rpcd/acl.d/luci-app-byedpi.json
	chmod 0755 /usr/libexec/byedpi-luci
	chmod 0755 /usr/libexec/byedpi-luci-test
	chmod 0755 /etc/uci-defaults/50_luci-byedpi
	# Configuration migration and cache refresh are handled once by this installer.
	rm -f /etc/uci-defaults/50_luci-byedpi
}

reload_luci() {
	info "Refreshing LuCI"
	rm -f /tmp/luci-indexcache* /var/luci-indexcache* 2>/dev/null || true
	if [ -x /etc/init.d/rpcd ]; then
		/etc/init.d/rpcd reload || return 1
	fi
}

main() {
	local src test_pid path

	trap cleanup 0
	trap 'exit 130' INT
	trap 'exit 143' TERM
	check_openwrt
	# Recover a dead worker before locking: status deliberately skips orphan
	# recovery while this shared lock protects a worker that is still starting.
	if [ -x /usr/libexec/byedpi-luci-test ]; then
		/usr/libexec/byedpi-luci-test status >/dev/null 2>&1 || true
	fi
	mkdir "$TEST_START_LOCK" 2>/dev/null || die "A test or another installation is starting; retry after it finishes"
	INSTALL_LOCKED=1
	case "$BYEDPI_START" in auto|0|1) ;; *) die "BYEDPI_START must be auto, 0 or 1" ;; esac
	[ -z "$(uci -q changes byedpi || true)$(uci -q changes podkop || true)" ] || die "Save or revert pending ByeDPI/Podkop changes in LuCI before updating"
	# Replacing a running shell worker may prevent its cleanup from executing.
	if [ -x /usr/libexec/byedpi-luci-test ]; then
		[ "$(cat /tmp/byedpi-luci-test-v2/state 2>/dev/null || true)" != running ] ||
			die "Stop the strategy test in LuCI before updating"
	fi
	test_pid="$(cat /tmp/byedpi-luci-test.lock/pid 2>/dev/null || true)"
	if [ -n "$test_pid" ] && kill -0 "$test_pid" 2>/dev/null; then
		die "Stop the legacy strategy test in LuCI before updating"
	fi
	if src="$(find_local_source)"; then
		info "Using local source: $src"
	else
		src="$(fetch_source)"
	fi
	for path in root/usr/libexec/byedpi-luci root/usr/libexec/byedpi-luci-test root/usr/share/byedpi-luci/score.awk htdocs/luci-static/resources/view/byedpi/main.js; do
		[ -s "$src/$path" ] || die "Source is incomplete: $path"
	done
	sh -n "$src/root/usr/libexec/byedpi-luci"
	sh -n "$src/root/usr/libexec/byedpi-luci-test"
	ensure_test_dependencies
	have curl && have netstat || die "curl and BusyBox netstat are required"
	[ -s /etc/ssl/certs/ca-certificates.crt ] || die "HTTPS certificate bundle is missing"
	WAS_ENABLED="$(bool_status /etc/init.d/byedpi enabled)"
	WAS_RUNNING="$(bool_status /etc/init.d/byedpi status)"
	backup_files
	MUTATING=1
	init_state
	if [ "${SKIP_BYEDPI_CHECK:-0}" != "1" ]; then
		ensure_byedpi
	fi
	configure_podkop_byedpi

	install_files "$src"
	reload_luci
	/usr/libexec/byedpi-luci status >/dev/null
	/usr/libexec/byedpi-luci-test status >/dev/null
	COMPLETE=1

	info "Installed ${APP_NAME}"
	echo "Open LuCI: Services -> ByeDPI"
	echo "Direct URL: /cgi-bin/luci/admin/services/byedpi"
}

main "$@"
