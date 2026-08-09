#!/usr/bin/env node
'use strict';
//
// coordination-ledger.cjs - the durable record of a session's coordination edges, so a HANDOVER can
// carry not just the work but the open questions and the peers. This is the CANONICAL implementation
// and schema; gsd-handover ships a read-only copy of readOpen/renderCoordinationSection against the
// same schema (see references/coordination-ledger.md - that doc is the cross-repo contract).
//
// WHY a ledger (not messaging): coordination edges are durable state. Messaging is a doorbell, not a
// database - so the fact that "I escalated question X to peer P and am waiting" lives in a durable
// append-only ledger under .planning/, and the handover baton reads it. Without this, the baton's
// Coordination section is always empty (fail-open to today's behaviour).
//
// House style: pure validators + a thin IO applier + a thin CLI. CommonJS, 'use strict'.
//
// LEDGER ENTRY (one JSON object per line, append-only):
//   { ts, kind: "escalation" | "peer", status: "open" | "resolved",
//     id?, question?, address, role?, scope?: "in-session" | "cross-session", note? }
//   - escalation: an open question this session is waiting on. address = who it is waiting on.
//     Mark it resolved by appending a second entry with the same id and status "resolved".
//   - peer: a coordination peer's address + role (so the successor can reach it by name, not discovery).
//
const fs = require('node:fs');
const path = require('node:path');

const KINDS = new Set(['escalation', 'peer']);
const STATUSES = new Set(['open', 'resolved']);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// validateEntry(e) -> { ok, errors }. Pure.
function validateEntry(e) {
  const errors = [];
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return { ok: false, errors: ['entry must be an object'] };
  if (typeof e.ts !== 'string' || !ISO_RE.test(e.ts)) errors.push('ts must be an ISO-8601 timestamp');
  if (!KINDS.has(e.kind)) errors.push(`kind must be one of: ${[...KINDS].join(', ')}`);
  if (!STATUSES.has(e.status)) errors.push(`status must be one of: ${[...STATUSES].join(', ')}`);
  if (typeof e.address !== 'string' || e.address.length === 0) errors.push('address must be a non-empty string');
  if (e.kind === 'escalation') {
    if (typeof e.id !== 'string' || e.id.length === 0) errors.push('escalation.id must be a non-empty string');
    // question is required on an OPEN escalation; a resolving entry may omit it.
    if (e.status === 'open' && (typeof e.question !== 'string' || e.question.length === 0)) {
      errors.push('an open escalation needs a non-empty question');
    }
  }
  if (e.kind === 'peer' && (typeof e.role !== 'string' || e.role.length === 0)) errors.push('peer.role must be a non-empty string');
  return { ok: errors.length === 0, errors };
}

// appendEntry(path, entry) -> { ok, error? }. Validates, then appends one JSONL line (append-only).
function appendEntry(filePath, entry) {
  const { ok, errors } = validateEntry(entry);
  if (!ok) return { ok: false, error: `invalid ledger entry: ${errors.join('; ')}` };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  return { ok: true };
}

// readOpen(path) -> { openEscalations:[{id,question,waitingOn,sentAt}], peers:[{address,role,note}] }.
// Folds the append-only log: an escalation is OPEN unless a later same-id entry resolved it; peers are
// deduped by address (latest wins). Every open escalation's address is guaranteed present in peers
// (so the baton's referential-integrity check passes), synthesizing a placeholder peer if needed.
function readOpen(filePath) {
  if (!fs.existsSync(filePath)) return { openEscalations: [], peers: [] };
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const escById = new Map();   // id -> {entry, open}
  const peerByAddr = new Map(); // address -> {address, role, note}
  for (const raw of lines) {
    if (raw.trim() === '') continue;
    let e; try { e = JSON.parse(raw); } catch { continue; }
    if (!validateEntry(e).ok) continue;
    if (e.kind === 'escalation') {
      escById.set(e.id, { entry: e, open: e.status === 'open' });
    } else if (e.kind === 'peer') {
      peerByAddr.set(e.address, { address: e.address, role: e.role, ...(e.note ? { note: e.note } : {}) });
    }
  }
  const openEscalations = [];
  for (const { entry, open } of escById.values()) {
    if (!open) continue;
    openEscalations.push({ id: entry.id, question: entry.question, waitingOn: entry.address, sentAt: entry.ts });
    if (!peerByAddr.has(entry.address)) {
      peerByAddr.set(entry.address, { address: entry.address, role: 'unknown', note: 'inferred from an open escalation' });
    }
  }
  return { openEscalations, peers: [...peerByAddr.values()] };
}

// ---- baton Coordination-section render/parse (the on-disk contract handover reads) ---------------

const COORD_HEADING = '## Coordination';
const FENCE_RE = /## Coordination\s*\n(?:<!--[^\n]*-->\s*\n)?```json\s*\n([\s\S]*?)\n```/;

function renderCoordinationSection(coord) {
  const payload = {
    openEscalations: Array.isArray(coord.openEscalations) ? coord.openEscalations : [],
    peers: Array.isArray(coord.peers) ? coord.peers : [],
  };
  return `${COORD_HEADING}\n`
    + `<!-- machine-readable; a handover successor reads this to re-establish its edges before continuing -->\n`
    + '```json\n' + JSON.stringify(payload, null, 2) + '\n```\n';
}

function parseCoordinationSection(md) {
  if (typeof md !== 'string') return { openEscalations: [], peers: [] };
  const m = md.match(FENCE_RE);
  if (!m) return { openEscalations: [], peers: [] };
  let obj; try { obj = JSON.parse(m[1]); } catch { return { openEscalations: [], peers: [] }; }
  return {
    openEscalations: Array.isArray(obj.openEscalations) ? obj.openEscalations : [],
    peers: Array.isArray(obj.peers) ? obj.peers : [],
  };
}

// ---- CLI (thin) ----------------------------------------------------------------------------------

function main(argv) {
  const cmd = argv[0];
  const getFlag = (n) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; };
  const file = getFlag('--file');
  if (cmd === 'append') {
    if (!file) { process.stderr.write('append requires --file <path>\n'); return 2; }
    const jsonArg = getFlag('--json');
    if (!jsonArg) { process.stderr.write('append requires --json <entry>\n'); return 2; }
    let e; try { e = JSON.parse(jsonArg); } catch { process.stderr.write('--json is not valid JSON\n'); return 2; }
    const r = appendEntry(file, e);
    if (!r.ok) { process.stderr.write(r.error + '\n'); return 1; }
    process.stdout.write('ok\n'); return 0;
  }
  if (cmd === 'open') { // print the open coordination state (what a baton would carry)
    if (!file) { process.stderr.write('open requires --file <path>\n'); return 2; }
    process.stdout.write(JSON.stringify(readOpen(file), null, 2) + '\n'); return 0;
  }
  if (cmd === 'render') { // print the ## Coordination markdown section from the ledger
    if (!file) { process.stderr.write('render requires --file <path>\n'); return 2; }
    process.stdout.write(renderCoordinationSection(readOpen(file))); return 0;
  }
  process.stderr.write('usage: coordination-ledger.cjs <append|open|render> --file <path> [--json <entry>]\n');
  return 2;
}

if (require.main === module) { process.exitCode = main(process.argv.slice(2)); }

module.exports = { validateEntry, appendEntry, readOpen, renderCoordinationSection, parseCoordinationSection, KINDS, STATUSES };
