const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const worker = path.resolve(__dirname, '../root/usr/libexec/byedpi-luci-test');
const bash = process.env.TEST_SHELL || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh');
function run(body) {
  assert.ok(fs.existsSync(worker), 'isolated test worker must exist');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byedpi-test-'));
  try {
    const source = fs.readFileSync(worker, 'utf8').split('# Dispatch')[0].replace(/^\. \/usr\/share\/libubox\/jshn\.sh$/m, '');
    fs.writeFileSync(path.join(dir, 'test.sh'), 'PATH=/usr/bin:/bin:$PATH\n' + source + '\n' + `WORK='${dir.replaceAll('\\', '/')}'\nprintf 'www.youtube.com|142.250.1.1\\nwww.gstatic.com|142.250.1.2\\nspeed.cloudflare.com|104.16.1.1\\n' > "$WORK/targets"\n` + body);
    const p = spawnSync(bash, [path.join(dir, 'test.sh')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(p.status, 0, p.stderr || p.error?.message || p.stdout);
    return p.stdout.trim();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('test strategies cannot take over the live listener or daemonize', () => {
  const args = run(`prepare_strategy '-i 0.0.0.0 -p1080 --daemon --pidfile /tmp/live.pid --cache-dump=/tmp/cache -s1 -At,s'\n`);
  assert.equal(args, '-s1 -At,s');
});
test('transparent mode and shell quoting are rejected instead of executed', () => {
  run(`if prepare_strategy '-E -s1'; then exit 1; fi\nif prepare_strategy '--fake-data="bad data"'; then exit 1; fi\nif prepare_strategy '-p'; then exit 1; fi\n`);
});
test('HTTP errors and incomplete transfers are recorded as failures', () => {
  const out = run(`
curl() { printf '403|0.1|0|0'; return 22; }
proxy_port=2080
probe 1 stable 1 youtube
curl() { printf '200|0.1|10|100'; return 0; }
probe 1 stable 1 download
cat "$WORK/samples"
`);
  const lines = out.split('\n').map(l => l.split('|'));
  assert.equal(lines.length, 2);
  assert.equal(lines[0][4], '0');
  assert.equal(lines[1][4], '0');
});
test('successful probes keep timing and transfer evidence', () => {
  const out = run(`
curl() { printf '204|0.188|0|0'; return 0; }
proxy_port=2080
probe 1 screen 1 google
cat "$WORK/samples"
`);
  assert.equal(out, '1|screen|1|google|1|188|0|0|0|204');
});

test('bulk probes are spread over time and capped at eight per candidate', () => {
  run(`put stable_started 1000; put minutes 60
date() { echo "$now"; }
now=1000; download_due 1 || exit 1
download_due 1 && exit 1
now=1449; download_due 1 && exit 1
now=1450; download_due 1 || exit 1
download_due 2 || exit 1
now=10000
for i in 1 2 3 4 5 6; do download_due 1 || exit 1; done
download_due 1 && exit 1
exit 0
`);
});

test('legacy report conversion preserves its timestamp and releases the shared lock', () => {
  run(`put state complete
printf '{"checked_at":123}' > "$WORK/status.json"
jsonfilter() { echo 123; }
snapshot() { [ "$1" = 123 ] || exit 9; printf '{"schema_version":2}' > "$WORK/status.json"; }
status >/dev/null
[ ! -d "$WORK.start" ] || exit 1
grep -q schema_version "$WORK/status.json"
`);
});
test('stop request prevents further network probes', () => {
  run(`touch "$WORK/stop"\ncurl() { echo network-called >&2; exit 1; }\nprobe 1 stable 1 youtube || :\n[ ! -s "$WORK/samples" ]\n`);
});
test('probe curl verifies certificates, resolves locally and has bounded traffic', () => {
  const out = run(`curl() { printf '%s\\n' "$@" > "$WORK/args"; printf '200|1|1048576|1048576'; }\nproxy_port=2080\nprobe 1 stable 1 download\ncat "$WORK/args"\n`);
  assert.match(out, /--socks5\n127\.0\.0\.1:2080/);
  assert.match(out, /--max-filesize\n1048576/);
  assert.match(out, /--resolve\nspeed.cloudflare.com:443:104.16.1.1/);
  assert.doesNotMatch(out, /(?:^|\n)--location(?:\n|$)/);
  assert.doesNotMatch(out, /(?:^|\n)(?:-k|--insecure|--retry)(?:\n|$)/);
});
test('FakeIP, local and malformed DNS answers are rejected', () => {
  run(`for ip in 198.18.0.76 198.19.255.255 127.0.0.1 10.0.0.1 172.16.0.1 192.168.1.1 0.0.0.0 256.1.1.1 invalid; do
if real_ipv4 "$ip"; then echo "accepted $ip" >&2; exit 1; fi
done
real_ipv4 142.250.1.1
`);
});
test('an unusable pinned address never reaches the proxy', () => {
  const out = run(`printf 'www.youtube.com|198.18.0.76\\n' > "$WORK/targets"
curl() { touch "$WORK/network-called"; return 1; }
probe 1 stable 1 youtube
[ ! -e "$WORK/network-called" ] || exit 1
cat "$WORK/samples"
`);
  assert.equal(out, '1|stable|1|youtube|0|0|0|0');
});
test('real DNS preparation pins only public addresses and uses authenticated HTTPS', () => {
  const out = run(`curl() { printf '%s\\n' "$@" >> "$WORK/dns-args"; printf '{}'; }
jsonfilter() { printf '198.18.0.76\\n142.250.1.1\\n'; }
resolve_targets
cat "$WORK/targets"
cat "$WORK/dns-args"
`);
  assert.match(out, /www.youtube.com\|142.250.1.1/);
  assert.doesNotMatch(out, /\|198\.18/);
  assert.match(out, /--resolve\ndns.google:443:8.8.8.8/);
  assert.doesNotMatch(out, /(?:^|\n)(?:-k|--insecure)(?:\n|$)/);
});
test('abbreviated and combined daemon options cannot escape isolation', () => {
  run(`if prepare_strategy '--dae -s1'; then exit 1; fi
if prepare_strategy '-Ds1'; then exit 1; fi
`);
});
test('stability rounds reuse the same process and cleanup only owned children', () => {
  run(`
CIADPI="$WORK/ciadpi"
printf '#!/bin/sh\\nexec sleep 30\\n' > "$CIADPI"
chmod +x "$CIADPI"
netstat() { :; }
snapshot() { :; }
probe() { :; }
printf '%s\\n' '-s1' > "$WORK/candidates"
run_candidate 1 stable 1
first="$(get proxy_pid_1)"
[ -n "$first" ] && kill -0 "$first" || exit 1
run_candidate 1 stable 2
[ "$(get proxy_pid_1)" = "$first" ] || exit 1
stop_all_proxies
if kill -0 "$first" 2>/dev/null; then exit 1; fi
`);
});
test('a crashed finalist is counted as a failure even if restarting succeeds', () => {
  const out = run(`
CIADPI="$WORK/ciadpi"
printf '#!/bin/sh\\nexec sleep 30\\n' > "$CIADPI"
chmod +x "$CIADPI"
netstat() { :; }; snapshot() { :; }; probe() { :; }
printf '%s\\n' '-s1' > "$WORK/candidates"
run_candidate 1 stable 1
kill "$(get proxy_pid_1)"
wait "$(get proxy_pid_1)" 2>/dev/null || :
run_candidate 1 stable 2
stop_all_proxies
cat "$WORK/samples"
`);
  assert.match(out, /1\|stable\|2\|start\|0\|0\|0\|0/);
});
