'use strict';
//
// Structural tests for capability.json. These mirror the invariants gsd-core's capability
// validator enforces (id == folder, strict semver, runtimeCompat, activationKey in config, config
// slice shape) plus this repo's own rules: (1) unlike most capabilities this one ships NO host hook
// (escalation and the doorbell fire inside workflow turns, not host lifecycle events), and (2) every
// reference/template/script the descriptor leans on exists on disk. They keep the descriptor
// installable without needing a gsd-core checkout.
//
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CAP_DIR = path.join(__dirname, '..', 'capabilities', 'messaging');
const cap = JSON.parse(fs.readFileSync(path.join(CAP_DIR, 'capability.json'), 'utf8'));

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const VALID_ROLES = new Set(['feature', 'runtime', 'reviewer']);
const VALID_TIERS = new Set(['core', 'standard', 'full']);
const VALID_SLICE_TYPES = new Set(['boolean', 'string', 'number', 'enum']);

test('id equals its folder name', () => {
  assert.equal(cap.id, 'messaging');
  assert.equal(cap.id, path.basename(CAP_DIR));
});

test('common envelope is well-formed', () => {
  assert.ok(VALID_ROLES.has(cap.role), `role ${cap.role} must be valid`);
  assert.equal(typeof cap.title, 'string');
  assert.ok(cap.title.length > 0);
  assert.equal(typeof cap.description, 'string');
  assert.ok(cap.description.length > 0);
  assert.ok(VALID_TIERS.has(cap.tier), `tier ${cap.tier} must be valid`);
  assert.ok(Array.isArray(cap.requires));
  assert.match(cap.version, SEMVER, 'version must be strict semver');
});

test('runtimeCompat restricts to claude', () => {
  assert.ok(cap.runtimeCompat && Array.isArray(cap.runtimeCompat.supported));
  assert.deepEqual(cap.runtimeCompat.supported, ['claude'], 'this capability is claude-only');
});

test('feature body arrays are present', () => {
  for (const k of ['skills', 'agents', 'hooks', 'steps', 'contributions', 'gates']) {
    assert.ok(Array.isArray(cap[k]), `${k} must be an array`);
  }
  assert.equal(typeof cap.config, 'object');
});

test('ships NO host hook (escalation and doorbell fire inside workflow turns)', () => {
  assert.deepEqual(cap.hooks, [], 'messaging needs no host lifecycle hook; keep hooks empty');
});

test('activationKey is a declared config key', () => {
  assert.equal(typeof cap.activationKey, 'string');
  assert.ok(Object.prototype.hasOwnProperty.call(cap.config, cap.activationKey),
    `activationKey ${cap.activationKey} must be in config`);
});

test('every config slice is well-shaped', () => {
  for (const [key, slice] of Object.entries(cap.config)) {
    assert.ok(VALID_SLICE_TYPES.has(slice.type), `${key}.type ${slice.type} invalid`);
    assert.ok(Object.prototype.hasOwnProperty.call(slice, 'default'), `${key} needs a default`);
    assert.equal(typeof slice.description, 'string');
    assert.ok(slice.description.length > 0, `${key} needs a description`);
    if (slice.type === 'enum') {
      assert.ok(Array.isArray(slice.values) && slice.values.length > 0, `${key} enum needs values`);
      assert.ok(slice.values.includes(slice.default), `${key} default must be one of values`);
    }
  }
});

test('documented payload files exist on disk', () => {
  const required = [
    'references/escalation-query-channel.md',
    'references/learning-doorbell.md',
    'references/trust-posture.md',
    'references/afk-decider.md',
    'templates/escalation-executor-brief.md',
    'templates/doorbell-receiver-convention.md',
    'templates/afk-decider.md',
    'policy/afk-decision-policy.example.json',
    'scripts/afk-decision-log.cjs',
    'sessions/gsd-sessions.mjs',
  ];
  for (const rel of required) {
    assert.ok(fs.existsSync(path.join(CAP_DIR, rel)), `missing payload file: ${rel}`);
  }
});

test('the example AFK policy is well-formed', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(CAP_DIR, 'policy', 'afk-decision-policy.example.json'), 'utf8'));
  assert.equal(policy.default_when_unmatched, 'escalate_to_human', 'unmatched classes must escalate');
  assert.ok(Array.isArray(policy.auto_decidable) && policy.auto_decidable.length > 0);
  assert.ok(Array.isArray(policy.escalate_to_human) && policy.escalate_to_human.length > 0);
  for (const c of policy.auto_decidable) {
    assert.equal(typeof c.class, 'string');
    assert.equal(typeof c.when, 'string');
    assert.equal(typeof c.bound, 'string', `auto_decidable class ${c.class} must carry a bound`);
  }
});
