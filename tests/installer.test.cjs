const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shell = process.env.TEST_SHELL || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh');
function run(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byedpi-install-'));
  const root = dir.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());
  try {
    const source = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8')
      .replace(/\nmain "\$@"\s*$/, '\n')
      .replace(/(?<![\w$])\/(etc|usr|www|tmp|var)(?=[/\s"']|$)/g, `${root}/$1`)
      .replace('cp -R "$src/root/." /', `cp -R "$src/root/." '${root}/'`);
    fs.mkdirSync(path.join(dir, 'etc/config'), {recursive:true});
    fs.mkdirSync(path.join(dir, 'etc/init.d'), {recursive:true});
    fs.writeFileSync(path.join(dir, 'test.sh'), 'PATH=/usr/bin:/bin:$PATH\n' + source + `\nROOT='${root}'\nWORK_DIR="$ROOT/work"\nmkdir -p "$WORK_DIR"\n` + body);
    const p = spawnSync(shell, [path.join(dir, 'test.sh')], {encoding:'utf8', timeout:15000});
    assert.equal(p.status, 0, p.stderr || p.stdout || p.error?.message);
    return p.stdout.trim();
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
}

test('updating an existing Podkop section preserves all user fields and does not restart', () => {
  run(`touch "$ROOT/etc/config/podkop"
uci() { case "$*" in '-q get podkop.byedpi') echo section;; *) echo "unexpected mutation: $*" >&2; exit 7;; esac; }
configure_podkop_byedpi
`);
});

const fullSetup = `
mkdir -p "$ROOT/tmp" "$ROOT/etc/ssl/certs" "$ROOT/source/htdocs/luci-static/resources/view/byedpi" "$ROOT/source/root/usr/libexec" "$ROOT/source/root/usr/share/byedpi-luci" "$ROOT/source/root/etc/uci-defaults"
printf cert > "$ROOT/etc/ssl/certs/ca-certificates.crt"
for helper in byedpi-luci byedpi-luci-test; do
 printf '#!/bin/sh\\nprintf "{}\\\\n"\\n' > "$ROOT/source/root/usr/libexec/$helper"
done
printf '// UI\\n' > "$ROOT/source/htdocs/luci-static/resources/view/byedpi/main.js"
printf '// alias\\n' > "$ROOT/source/htdocs/luci-static/resources/view/byedpi/byedpi.js"
printf '# awk\\n' > "$ROOT/source/root/usr/share/byedpi-luci/score.awk"
for name in strategies.txt domains.txt proxytest.results; do printf test > "$ROOT/source/root/usr/share/byedpi-luci/$name"; done
mkdir -p "$ROOT/source/root/usr/share/luci/menu.d" "$ROOT/source/root/usr/share/rpcd/acl.d"
printf '{}' > "$ROOT/source/root/usr/share/luci/menu.d/luci-app-byedpi.json"
printf '{}' > "$ROOT/source/root/usr/share/rpcd/acl.d/luci-app-byedpi.json"
printf '#!/bin/sh\\nexit 0\\n' > "$ROOT/source/root/etc/uci-defaults/50_luci-byedpi"
printf 'old configuration\\n' > "$ROOT/etc/config/byedpi"
printf 'old podkop configuration\\n' > "$ROOT/etc/config/podkop"
check_openwrt() { :; }
find_local_source() { echo "$ROOT/source"; }
has_byedpi() { return 0; }
uci() { case "$*" in
 '-q changes byedpi'|'-q changes podkop'|'-q revert byedpi'|'-q revert podkop') :;;
 '-q get byedpi.main'|'-q get podkop.byedpi') echo section;;
 '-q get byedpi.main.enabled') echo 1;;
 '-q get byedpi.main.cmd_opts'|'-q get byedpi.main.options') echo '-s1';;
 *) echo "Unexpected UCI write: $*" >&2; exit 8;;
esac; }
have() { return 0; }
`;
test('complete local-source update preserves configs and cleans the installation lock', () => {
  run(fullSetup + `
reload_luci() { :; }
(main)
[ "$(cat "$ROOT/etc/config/byedpi")" = 'old configuration' ]
[ "$(cat "$ROOT/etc/config/podkop")" = 'old podkop configuration' ]
[ -x "$ROOT/usr/libexec/byedpi-luci-test" ]
[ -s "$STATE_DIR/rollback.tar.gz" ]
[ ! -d "$TEST_START_LOCK" ]
`);
});
test('late installation failure rolls files back and returns a failure', () => {
  run(fullSetup + `
reload_luci() { touch "$ROOT/reload-attempted"; return 4; }
set +e
(set -e; main)
code=$?
set -e
[ "$code" != 0 ]
[ -e "$ROOT/reload-attempted" ]
[ "$(cat "$ROOT/etc/config/byedpi")" = 'old configuration' ]
[ "$(cat "$ROOT/etc/config/podkop")" = 'old podkop configuration' ]
[ ! -e "$ROOT/usr/libexec/byedpi-luci-test" ]
[ ! -e "$ROOT/www/luci-static/resources/view/byedpi/main.js" ]
[ ! -d "$TEST_START_LOCK" ]
`);
});

test('an interrupted test is recovered before taking the installer lock', () => {
  run(fullSetup + `
mkdir -p "$ROOT/usr/libexec" "$ROOT/tmp/byedpi-luci-test-v2"
printf running > "$ROOT/tmp/byedpi-luci-test-v2/state"
cat > "$ROOT/usr/libexec/byedpi-luci-test" <<EOF
#!/bin/sh
if [ ! -d '$TEST_START_LOCK' ]; then
 printf interrupted > '$ROOT/tmp/byedpi-luci-test-v2/state'
fi
EOF
chmod +x "$ROOT/usr/libexec/byedpi-luci-test"
reload_luci() { :; }
(main)
[ "$(cat "$ROOT/tmp/byedpi-luci-test-v2/state")" = interrupted ]
[ ! -d "$TEST_START_LOCK" ]
`);
});
test('existing engine keeps its runtime and autostart state by default', () => {
  run(`printf '#!/bin/sh\\ntouch "%s/called"\\nexit 7\\n' "$ROOT" > "$ROOT/etc/init.d/byedpi"
chmod +x "$ROOT/etc/init.d/byedpi"
start_byedpi_service 1
[ ! -e "$ROOT/called" ]
`);
});
test('an explicit service start failure is reported', () => {
  run(`printf '#!/bin/sh\\nexit 7\\n' > "$ROOT/etc/init.d/byedpi"
chmod +x "$ROOT/etc/init.d/byedpi"
BYEDPI_START=1
if (start_byedpi_service 0); then exit 9; fi
`);
});
test('new Podkop section gets safe defaults and is tracked for uninstall', () => {
  const output = run(`touch "$ROOT/etc/config/podkop"
uci() { case "$*" in '-q get podkop.byedpi') return 1;; *) printf '%s\\n' "$*";; esac; }
PODKOP_RESTART=0
configure_podkop_byedpi
cat "$STATE_FILE"
`);
  assert.match(output, /set podkop.byedpi.resolve_real_ip_for_routing=1/);
  assert.match(output, /podkop_section_created_by_installer=1/);
});
test('missing curl and certificates are installed with the native package manager', () => {
  const output = run(`have() { [ "$1" = opkg ]; }
opkg() { printf '%s\\n' "$*"; }
ensure_test_dependencies
`);
  assert.match(output, /update/);
  assert.match(output, /install curl ca-bundle/);
});
test('rollback restores previous content and removes files introduced by an update', () => {
  run(`mkdir -p "$ROOT/usr/libexec"
printf 'old helper\\n' > "$ROOT/usr/libexec/byedpi-luci"
printf 'keep config\\n' > "$ROOT/etc/config/byedpi"
backup_files
printf 'changed\\n' > "$ROOT/usr/libexec/byedpi-luci"
printf 'new worker\\n' > "$ROOT/usr/libexec/byedpi-luci-test"
printf 'bad config\\n' > "$ROOT/etc/config/byedpi"
rollback_files
[ "$(cat "$ROOT/usr/libexec/byedpi-luci")" = 'old helper' ]
[ "$(cat "$ROOT/etc/config/byedpi")" = 'keep config' ]
[ ! -e "$ROOT/usr/libexec/byedpi-luci-test" ]
`);
});
