'use strict';
//
// Tests for the coordination ledger: validation, append-only fold (open vs resolved), peer synthesis,
// and the render/parse round-trip of the baton's ## Coordination section.
//
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../capabilities/messaging/scripts/coordination-ledger.cjs');

const esc = (over = {}) => ({ ts: '2026-08-09T00:00:00.000Z', kind: 'escalation', status: 'open', id: 'esc-1', question: 'JSON, YAML, or TOML?', address: 'orchestrator [ab12cd]', ...over });
const peer = (over = {}) => ({ ts: '2026-08-09T00:00:00.000Z', kind: 'peer', status: 'open', address: 'orchestrator [ab12cd]', role: 'orchestrator', ...over });

function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-')); return path.join(d, 'coordination.jsonl'); }

test('a valid escalation and peer entry validate', () => {
  assert.equal(L.validateEntry(esc()).ok, true);
  assert.equal(L.validateEntry(peer()).ok, true);
});

test('an open escalation without a question is rejected', () => {
  const { ok, errors } = L.validateEntry(esc({ question: '' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /open escalation needs a non-empty question/.test(e)));
});

test('append-only fold: a later resolved entry closes an open escalation', () => {
  const f = tmp();
  try {
    assert.equal(L.appendEntry(f, peer()).ok, true);
    assert.equal(L.appendEntry(f, esc()).ok, true);
    let open = L.readOpen(f);
    assert.equal(open.openEscalations.length, 1);
    // resolve it (a resolving entry may omit the question)
    assert.equal(L.appendEntry(f, { ts: '2026-08-09T01:00:00.000Z', kind: 'escalation', status: 'resolved', id: 'esc-1', address: 'orchestrator [ab12cd]' }).ok, true);
    open = L.readOpen(f);
    assert.equal(open.openEscalations.length, 0, 'resolved escalation drops out');
    assert.equal(open.peers.length, 1, 'peer stays');
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
});

test('readOpen synthesizes a peer for an escalation whose address has no peer entry', () => {
  const f = tmp();
  try {
    L.appendEntry(f, esc({ address: 'ghost [99]' }));  // no matching peer entry
    const open = L.readOpen(f);
    assert.equal(open.openEscalations[0].waitingOn, 'ghost [99]');
    const p = open.peers.find((x) => x.address === 'ghost [99]');
    assert.ok(p, 'a placeholder peer is synthesized so the baton referential-integrity check passes');
    assert.equal(p.role, 'unknown');
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
});

test('a corrupted line is skipped, not fatal', () => {
  const f = tmp();
  try {
    L.appendEntry(f, esc());
    fs.appendFileSync(f, 'not json\n');
    const open = L.readOpen(f);
    assert.equal(open.openEscalations.length, 1);
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
});

test('render -> parse round-trips the coordination section', () => {
  const coord = { openEscalations: [{ id: 'esc-1', question: 'q?', waitingOn: 'o [1]', sentAt: '2026-08-09T00:00:00.000Z' }], peers: [{ address: 'o [1]', role: 'orchestrator' }] };
  const md = L.renderCoordinationSection(coord);
  assert.deepEqual(L.parseCoordinationSection(md), coord);
});

test('render of an empty ledger yields an empty (but valid) section', () => {
  const f = tmp();
  try {
    const md = L.renderCoordinationSection(L.readOpen(f));
    assert.deepEqual(L.parseCoordinationSection(md), { openEscalations: [], peers: [] });
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
});

test('readOpen on a missing file is empty (fail-open)', () => {
  assert.deepEqual(L.readOpen(path.join(os.tmpdir(), 'does-not-exist-coord.jsonl')), { openEscalations: [], peers: [] });
});
