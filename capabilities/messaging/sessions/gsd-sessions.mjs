#!/usr/bin/env node
// gsd-sessions - Pattern E / O2 conductor dashboard (inter-agent-messaging spike prototype).
//
// A read-only view of every Claude Code session on this machine, correlated with its GSD phase
// state. Zero messaging risk (Gall's safe first slice): it only reads `claude agents --json`, each
// session's durable `.planning/STATE.md`, and the statusline context bridge file. Nothing is sent,
// steered, or mutated.
//
// Usage:  node gsd-sessions.mjs [--json] [--gsd-only]
//   --json      emit the correlated rows as JSON instead of a table
//   --gsd-only  show only sessions whose cwd is a GSD project (has .planning/STATE.md)
//
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const AS_JSON = args.has('--json');
const GSD_ONLY = args.has('--gsd-only');

function listAgents() {
  try {
    return JSON.parse(execFileSync('claude', ['agents', '--json'], { encoding: 'utf8' }));
  } catch {
    return [];
  }
}

// Read a dotted-free frontmatter key from a STATE.md (nested/flat tolerant is unnecessary here -
// GSD frontmatter is flat `key: value`). Returns null when absent.
function fmValue(text, key) {
  const m = text.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
  return m ? m[1].replace(/^"|"$/g, '').trim() : null;
}

function gsdState(cwd) {
  if (!cwd) return null;
  const stateFile = path.join(cwd, '.planning', 'STATE.md');
  let text;
  try {
    text = fs.readFileSync(stateFile, 'utf8');
  } catch {
    return null; // not a GSD project
  }
  return {
    milestone: fmValue(text, 'milestone_name') || fmValue(text, 'milestone'),
    phase: fmValue(text, 'current_phase_name'),
    status: fmValue(text, 'status'),
    lastActivity: fmValue(text, 'last_activity'),
  };
}

function contextRemaining(sessionId) {
  if (!sessionId) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`), 'utf8'));
    return typeof j.remaining_percentage === 'number' ? j.remaining_percentage : null;
  } catch {
    return null;
  }
}

function shortId(a) {
  const id = a.id || a.sessionId || '';
  return String(id).slice(0, 8);
}

function buildRows() {
  const rows = [];
  for (const a of listAgents()) {
    const cwd = a.cwd || '';
    const gsd = gsdState(cwd);
    if (GSD_ONLY && !gsd) continue;
    rows.push({
      id: shortId(a),
      name: a.name || '',
      kind: a.kind || '',
      status: a.status || a.state || '',
      repo: cwd ? path.basename(cwd) : '',
      milestone: gsd?.milestone || '',
      phase: gsd?.phase || (gsd ? '(no phase)' : ''),
      gsdStatus: gsd?.status || '',
      ctxPct: contextRemaining(a.sessionId || a.id),
      isGsd: !!gsd,
    });
  }
  // Sort: GSD sessions first, then by ascending context remaining (closest-to-limit first, so the
  // conductor sees which sessions a handover should target).
  rows.sort((x, y) => {
    if (x.isGsd !== y.isGsd) return x.isGsd ? -1 : 1;
    const cx = x.ctxPct == null ? 999 : x.ctxPct;
    const cy = y.ctxPct == null ? 999 : y.ctxPct;
    return cx - cy;
  });
  return rows;
}

function pad(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

function ctxCell(pct) {
  if (pct == null) return pad('-', 6);
  const flag = pct <= 25 ? ' !' : pct <= 40 ? ' .' : '  ';
  return pad(pct + '%' + flag, 6);
}

function printTable(rows) {
  const gsdCount = rows.filter((r) => r.isGsd).length;
  console.log(`GSD sessions dashboard - ${rows.length} session(s), ${gsdCount} in a GSD project`);
  console.log('(ctx: remaining context %; ! <=25 near handover watermark, . <=40)\n');
  console.log(
    pad('ID', 9) + pad('NAME', 24) + pad('KIND', 12) + pad('STATUS', 9) +
    pad('CTX', 6) + pad('REPO', 16) + pad('PHASE', 26) + 'GSD-STATUS'
  );
  console.log('-'.repeat(112));
  for (const r of rows) {
    console.log(
      pad(r.id, 9) + pad(r.name, 24) + pad(r.kind, 12) + pad(r.status, 9) +
      ctxCell(r.ctxPct) + pad(r.repo, 16) + pad(r.phase, 26) + r.gsdStatus
    );
  }
}

const rows = buildRows();
if (AS_JSON) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  printTable(rows);
}
