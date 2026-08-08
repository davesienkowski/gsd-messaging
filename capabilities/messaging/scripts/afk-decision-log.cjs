#!/usr/bin/env node
'use strict';
//
// afk-decision-log.cjs - append-only, schema-validated audit log for AFK (unattended) decisions.
//
// WHY: Claude Code has no platform per-sender allowlist (crossSessionInbound is a global
// accept/hold/refuse posture, not identity-keyed), so an autonomous "decider" cannot be hard-gated
// by sender identity. Accountability for unattended decisions therefore comes from an audit trail,
// not an allowlist: every AFK decision is recorded so it is reviewable after the fact. This module
// is the durable substrate for idea #9 (AFK checkpoint delegation).
//
// House style: pure validators + a thin IO applier + a thin CLI. CommonJS, 'use strict'.
//
const fs = require('node:fs');
const path = require('node:path');

// A decision record. `basis` says how it was resolved:
//   auto                -> the autonomous decider resolved it within policy; `decision` is one of `options`
//   human               -> a human resolved it; `decision` is one of `options`
//   escalated-to-human  -> policy said this class must go to a human; `decision` is null (pending)
const REQUIRED = ['ts', 'context', 'question', 'options', 'decision', 'decider', 'policyClass', 'basis', 'rationale'];
const BASIS = new Set(['auto', 'human', 'escalated-to-human']);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// validateRecord(rec) -> { ok, errors: string[] }. Pure; no IO.
function validateRecord(rec) {
  const errors = [];
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    return { ok: false, errors: ['record must be a plain object'] };
  }
  for (const k of REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(rec, k)) errors.push(`missing field: ${k}`);
  }
  if (typeof rec.ts === 'string' && !ISO_RE.test(rec.ts)) errors.push('ts must be an ISO-8601 timestamp');
  for (const k of ['context', 'question', 'decider', 'policyClass', 'rationale']) {
    if (rec[k] !== undefined && (typeof rec[k] !== 'string' || rec[k].length === 0)) {
      errors.push(`${k} must be a non-empty string`);
    }
  }
  if (rec.options !== undefined) {
    if (!Array.isArray(rec.options) || rec.options.length < 2 || !rec.options.every((o) => typeof o === 'string' && o.length > 0)) {
      errors.push('options must be an array of at least two non-empty strings');
    }
  }
  if (rec.basis !== undefined && !BASIS.has(rec.basis)) {
    errors.push(`basis must be one of: ${[...BASIS].join(', ')}`);
  }
  // decision rules depend on basis
  if (rec.basis === 'escalated-to-human') {
    if (rec.decision !== null) errors.push('decision must be null when basis is escalated-to-human (pending a human)');
  } else if (rec.basis === 'auto' || rec.basis === 'human') {
    if (typeof rec.decision !== 'string' || rec.decision.length === 0) {
      errors.push('decision must be a non-empty string when basis is auto or human');
    } else if (Array.isArray(rec.options) && !rec.options.includes(rec.decision)) {
      errors.push('decision must be one of options');
    }
  }
  return { ok: errors.length === 0, errors };
}

// appendDecision(filePath, rec) -> { ok, error? }. Validates, then appends one JSONL line.
// Append-only: never rewrites existing lines. Creates the parent dir and file if absent.
function appendDecision(filePath, rec) {
  const { ok, errors } = validateRecord(rec);
  if (!ok) return { ok: false, error: `invalid record: ${errors.join('; ')}` };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(rec) + '\n');
  return { ok: true };
}

// verifyLog(filePath) -> { ok, count, invalid: [{ line, errors }] }. Reads and validates every line.
function verifyLog(filePath) {
  if (!fs.existsSync(filePath)) return { ok: true, count: 0, invalid: [] };
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const invalid = [];
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    count++;
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      invalid.push({ line: i + 1, errors: ['not valid JSON'] });
      continue;
    }
    const { ok, errors } = validateRecord(rec);
    if (!ok) invalid.push({ line: i + 1, errors });
  }
  return { ok: invalid.length === 0, count, invalid };
}

function main(argv) {
  const cmd = argv[0];
  const getFlag = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const file = getFlag('--file');
  if (cmd === 'append') {
    if (!file) { process.stderr.write('append requires --file <path>\n'); return 2; }
    const jsonArg = getFlag('--json');
    if (!jsonArg) { process.stderr.write('append requires --json <record>\n'); return 2; }
    let rec;
    try { rec = JSON.parse(jsonArg); } catch { process.stderr.write('--json is not valid JSON\n'); return 2; }
    const r = appendDecision(file, rec);
    if (!r.ok) { process.stderr.write(r.error + '\n'); return 1; }
    process.stdout.write('ok\n');
    return 0;
  }
  if (cmd === 'verify') {
    if (!file) { process.stderr.write('verify requires --file <path>\n'); return 2; }
    const r = verifyLog(file);
    process.stdout.write(JSON.stringify(r) + '\n');
    return r.ok ? 0 : 1;
  }
  process.stderr.write('usage: afk-decision-log.cjs <append|verify> --file <path> [--json <record>]\n');
  return 2;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { validateRecord, appendDecision, verifyLog, REQUIRED, BASIS };
