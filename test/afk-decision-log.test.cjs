'use strict';
//
// Tests for the AFK decision audit log: the validation rules and the append-only / verify round-trip.
// Pure-function tests plus a temp-file IO test. No network, hermetic.
//
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateRecord, appendDecision, verifyLog } = require('../capabilities/messaging/scripts/afk-decision-log.cjs');

const goodAuto = () => ({
  ts: '2026-08-08T22:00:00.000Z',
  context: 'phase 3 / plan 3-2',
  question: 'iterative loop or closed-form formula?',
  options: ['iterative', 'formula'],
  decision: 'formula',
  decider: 'main',
  policyClass: 'equivalent-implementation-approach',
  basis: 'auto',
  rationale: 'both correct; formula is simpler and O(1)',
});

test('a well-formed auto record validates', () => {
  const { ok, errors } = validateRecord(goodAuto());
  assert.equal(ok, true, errors.join('; '));
});

test('escalated-to-human requires a null decision', () => {
  const rec = { ...goodAuto(), basis: 'escalated-to-human', decision: null };
  assert.equal(validateRecord(rec).ok, true);
  const bad = { ...goodAuto(), basis: 'escalated-to-human', decision: 'formula' };
  assert.equal(validateRecord(bad).ok, false, 'a concrete decision under escalated-to-human must fail');
});

test('auto/human decision must be one of options', () => {
  const bad = { ...goodAuto(), decision: 'recursion' };
  const { ok, errors } = validateRecord(bad);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /one of options/.test(e)));
});

test('missing required fields are reported', () => {
  const rec = goodAuto();
  delete rec.rationale;
  delete rec.decider;
  const { ok, errors } = validateRecord(rec);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /rationale/.test(e)));
  assert.ok(errors.some((e) => /decider/.test(e)));
});

test('bad basis and too-few options are rejected', () => {
  assert.equal(validateRecord({ ...goodAuto(), basis: 'whatever' }).ok, false);
  assert.equal(validateRecord({ ...goodAuto(), options: ['only-one'] }).ok, false);
});

test('non-ISO timestamp is rejected', () => {
  assert.equal(validateRecord({ ...goodAuto(), ts: 'yesterday' }).ok, false);
});

test('append is append-only and verify passes for a good log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-log-'));
  const file = path.join(dir, 'nested', 'afk-decisions.jsonl'); // parent dir does not exist yet
  try {
    assert.equal(appendDecision(file, goodAuto()).ok, true);
    assert.equal(appendDecision(file, { ...goodAuto(), decision: 'iterative' }).ok, true);
    const body = fs.readFileSync(file, 'utf8');
    assert.equal(body.split('\n').filter((l) => l.trim()).length, 2, 'two JSONL lines appended');
    const v = verifyLog(file);
    assert.equal(v.ok, true);
    assert.equal(v.count, 2);
    assert.deepEqual(v.invalid, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('append refuses an invalid record (nothing written)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-log-'));
  const file = path.join(dir, 'afk-decisions.jsonl');
  try {
    const r = appendDecision(file, { ...goodAuto(), decision: 'recursion' });
    assert.equal(r.ok, false);
    assert.ok(/invalid record/.test(r.error));
    assert.equal(fs.existsSync(file), false, 'no file created for a rejected record');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify flags a corrupted line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-log-'));
  const file = path.join(dir, 'afk-decisions.jsonl');
  try {
    appendDecision(file, goodAuto());
    fs.appendFileSync(file, 'not json\n');
    fs.appendFileSync(file, JSON.stringify({ ts: 'nope' }) + '\n');
    const v = verifyLog(file);
    assert.equal(v.ok, false);
    assert.equal(v.count, 3);
    assert.equal(v.invalid.length, 2);
    assert.equal(v.invalid[0].line, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
