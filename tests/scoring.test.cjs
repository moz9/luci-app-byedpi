const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const scoreFile = path.resolve(__dirname, '../root/usr/share/byedpi-luci/score.awk');
const awk = process.env.AWK || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/awk.exe' : 'awk');
function rank(rows, stage = 'stable') {
  assert.ok(fs.existsSync(scoreFile), 'the stability scorer must exist');
  const p = spawnSync(awk, ['-v', `stage=${stage}`, '-f', scoreFile], { input: rows.join('\n') + '\n', encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim().split('\n').filter(Boolean).map(line => {
    const v = line.split('|').map(Number);
    return Object.fromEntries(['id', 'total', 'failed', 'slow', 'median', 'p95', 'jitter', 'minRate', 'rounds', 'eligible'].map((key, i) => [key, v[i]]));
  });
}
function samples(id, times, failures = [], stage = 'stable', rate = 1000000) {
  return times.map((ms, i) => [id, stage, 1 + Math.floor(i / 4), i % 2 ? 'google' : 'youtube', failures.includes(i) ? 0 : 1, ms, 0, 0].join('|'))
    .concat([id, stage, 1, 'download', 1, 1000, 1048576, rate].join('|'));
}
test('a reliable candidate beats a faster candidate that times out', () => {
  const rows = rank([...samples(1, Array(12).fill(50), [5]), ...samples(2, Array(12).fill(300))]);
  assert.equal(rows[0].id, 2);
  assert.equal(rows[0].eligible, 1);
  assert.equal(rows[1].eligible, 0);
});
test('repeated three-second stalls lose to consistent responses', () => {
  const rows = rank([...samples(1, [188, 3171, 188, 3171, 188, 3171, 188, 3171, 188, 3171, 188, 3171]), ...samples(2, Array(12).fill(400))]);
  assert.equal(rows[0].id, 2);
  assert.equal(rows[1].slow, 6);
  assert.equal(rows[1].p95, 3171);
  assert.equal(rows[1].eligible, 0);
});
test('insufficient or short screening evidence cannot recommend a winner', () => {
  assert.equal(rank(samples(1, [200, 200, 200, 200]))[0].eligible, 0);
  assert.equal(rank(samples(1, Array(12).fill(200), [], 'screen'), 'screen')[0].eligible, 0);
});
test('screening results cannot hide later failures', () => {
  const row = rank([...samples(1, Array(100).fill(10), [], 'screen'), ...samples(1, Array(12).fill(300), [3])])[0];
  assert.equal(row.total, 13);
  assert.equal(row.failed, 1);
});
test('when reliability and latency match, sustained transfer breaks the tie', () => {
  assert.equal(rank([...samples(1, Array(12).fill(200), [], 'stable', 100000), ...samples(2, Array(12).fill(200), [], 'stable', 300000)])[0].id, 2);
});
test('a millisecond advantage cannot outweigh much better transfer at comparable latency', () => {
  const rows = [...samples(1, Array(12).fill(522), [], 'stable', 316339),
    ...samples(2, Array(12).fill(523), [], 'stable', 910943)];
  assert.equal(rank(rows)[0].id, 2);
});
test('substantially worse tail latency still loses despite a faster transfer', () => {
  const rows = [...samples(1, Array(12).fill(520), [], 'stable', 500000),
    ...samples(2, Array(12).fill(950), [], 'stable', 5000000)];
  assert.equal(rank(rows)[0].id, 1);
});
test('latency bands give a consistent ordering independent of input order', () => {
  const groups = [samples(1, Array(12).fill(499), [], 'stable', 100000),
    samples(2, Array(12).fill(501), [], 'stable', 900000),
    samples(3, Array(12).fill(550), [], 'stable', 1000000)];
  assert.deepEqual(rank(groups.flat()).map(r => r.id), rank(groups.reverse().flat()).map(r => r.id));
});
test('all failures, empty input and an absent endpoint never look healthy', () => {
  assert.deepEqual(rank([]), []);
  assert.equal(rank(samples(1, Array(12).fill(8000), Array.from({length: 12}, (_, i) => i)))[0].eligible, 0);
  const onlyGoogle = samples(1, Array(12).fill(200)).map(row => row.replace('|youtube|', '|google|'));
  assert.equal(rank(onlyGoogle)[0].eligible, 0);
});
