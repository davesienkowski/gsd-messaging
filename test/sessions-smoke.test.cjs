'use strict';
// Smoke test for the O2 conductor dashboard: the script runs and emits the row-shape contract.
// Not hermetic (reads live `claude agents`), so it asserts the CONTRACT, not specific sessions:
// valid JSON array, and when rows exist each carries the documented keys. Skips gracefully when
// the `claude` CLI is not on PATH so a bare clone still passes `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'capabilities', 'messaging', 'sessions', 'gsd-sessions.mjs');
const KEYS = ['id', 'name', 'kind', 'status', 'repo', 'milestone', 'phase', 'gsdStatus', 'ctxPct', 'isGsd'];

const hasClaude = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = hasClaude ? false : 'claude CLI not on PATH';

test('gsd-sessions --json emits a valid JSON array of correctly-shaped rows', { skip }, () => {
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  let rows;
  assert.doesNotThrow(() => { rows = JSON.parse(r.stdout); }, 'output must be valid JSON');
  assert.ok(Array.isArray(rows), 'output must be an array');
  for (const row of rows) {
    for (const k of KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, k), `row missing key: ${k}`);
    }
    assert.equal(typeof row.isGsd, 'boolean');
    assert.ok(row.ctxPct === null || typeof row.ctxPct === 'number');
  }
});

test('gsd-sessions (table mode) runs and prints a header', { skip }, () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /GSD sessions dashboard/);
  assert.match(r.stdout, /PHASE/);
});
