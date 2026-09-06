const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shell = process.env.TEST_SHELL || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh');
function run(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byedpi-apply-'));
  const root = dir.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase());
  try {
    const source = fs.readFileSync(path.join(__dirname, '../root/usr/libexec/byedpi-luci'), 'utf8')
      .split('\ncase "$1" in')[0].replace(/^\. \/usr\/share\/libubox\/jshn.sh$/m, '')
      .replace(/(?<![\w$])\/(etc|usr|www|tmp|var)(?=[/\s"']|$)/g, `${root}/$1`);
    fs.mkdirSync(path.join(dir, 'etc/config'), {recursive:true});
    fs.mkdirSync(path.join(dir, 'etc/init.d'), {recursive:true});
    fs.mkdirSync(path.join(dir, 'tmp'), {recursive:true});
    fs.writeFileSync(path.join(dir, 'test.sh'), 'PATH=/usr/bin:/bin:$PATH\n' + `set -e\n` + source + `\nROOT='${root}'\n` + body);
    const p = spawnSync(shell, [path.join(dir, 'test.sh')], {encoding:'utf8',timeout:15000});
    assert.equal(p.status, 0, p.stderr || p.stdout || p.error?.message);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
}
test('failed strategy application restores the previous configuration and returns failure', () => {
  run(`printf 'old configuration\\n' > "$ROOT/etc/config/byedpi"
printf '#!/bin/sh\\ncase "$1" in status|enabled) exit 1;; esac\\nexit 7\\n' > "$ROOT/etc/init.d/byedpi"
chmod +x "$ROOT/etc/init.d/byedpi"
uci() { case "$1" in set) printf 'changed\\n' > "$ROOT/etc/config/byedpi";; esac; }
json_status() { echo '{}'; }
if apply_strategy '-s1' 1; then exit 8; fi
[ "$(cat "$ROOT/etc/config/byedpi")" = 'old configuration' ]
`);
});
test('another page cannot apply a strategy while a stability test is running', () => {
  run(`mkdir -p "$ROOT/tmp/byedpi-luci-test-v2"
printf running > "$ROOT/tmp/byedpi-luci-test-v2/state"
uci() { echo 'unexpected UCI call' >&2; exit 7; }
json_status() { echo '{}'; }
if apply_strategy '-s1' 1; then exit 8; fi
`);
});
test('service action failure is not reported as a successful status response', () => {
  run(`printf '#!/bin/sh\\nexit 7\\n' > "$ROOT/etc/init.d/byedpi"
chmod +x "$ROOT/etc/init.d/byedpi"
json_status() { echo '{}'; }
if service_action restart; then exit 8; fi
`);
});
test('a process that exits after a successful init command triggers rollback', () => {
  run(`printf old > "$ROOT/etc/config/byedpi"
printf '#!/bin/sh\\nif [ "$1" = status ]; then [ "$(cat "%s/etc/config/byedpi")" = old ]; else exit 0; fi\\n' "$ROOT" > "$ROOT/etc/init.d/byedpi"
chmod +x "$ROOT/etc/init.d/byedpi"
uci() { case "$1" in set) printf bad > "$ROOT/etc/config/byedpi";; esac; }
sleep() { :; }
json_status() { echo '{}'; }
if apply_strategy '--invalid-option' 1; then exit 8; fi
[ "$(cat "$ROOT/etc/config/byedpi")" = old ]
[ ! -d "$ROOT/tmp/byedpi-luci-test-v2.start" ]
`);
});
test('a successful apply keeps the new configuration and releases the lock', () => {
  run(`printf old > "$ROOT/etc/config/byedpi"
printf '#!/bin/sh\\nexit 0\\n' > "$ROOT/etc/init.d/byedpi"
chmod +x "$ROOT/etc/init.d/byedpi"
uci() { case "$1" in set) printf new > "$ROOT/etc/config/byedpi";; esac; }
sleep() { :; }
json_status() { echo '{}'; }
apply_strategy '-s1' 1
[ "$(cat "$ROOT/etc/config/byedpi")" = new ]
[ ! -d "$ROOT/tmp/byedpi-luci-test-v2.start" ]
`);
});
