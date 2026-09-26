const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('read-only RPC permission cannot execute the mutating helper', () => {
  const acl = JSON.parse(read('root/usr/share/rpcd/acl.d/luci-app-byedpi.json'))['luci-app-byedpi'];
  assert.equal(acl.read.file?.['/usr/libexec/byedpi-luci'], undefined);
  assert.deepEqual(acl.write.file['/usr/libexec/byedpi-luci'], ['exec']);
  assert.deepEqual(acl.write.uci, ['byedpi']);
  const menu = JSON.parse(read('root/usr/share/luci/menu.d/luci-app-byedpi.json'));
  assert.equal(menu['admin/services/byedpi'].depends.uci.byedpi, true);
});

test('initial LuCI load does not wait for network diagnostics', () => {
  const view = read('htdocs/luci-static/resources/view/byedpi/main.js');
  const load = view.slice(view.indexOf('\tload: function() {'), view.indexOf('\n\trender: function(data)'));
  assert.doesNotMatch(load, /execJson\(\[ "diagnostics" \]/);
  assert.match(view, /name === "diagnostics" && !diagnosticsLoaded/);
});

test('installer uses structured release JSON and ignores local source when piped', () => {
  const installer = read('install.sh');
  assert.match(installer, /jsonfilter -i "\$release_json" -e '@\.assets\[\*\]\.browser_download_url'/);
  assert.match(installer, /case "\$0" in \*\/install\.sh\|install\.sh\)/);
});
