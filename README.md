# gsd-messaging

Live coordination between GSD sessions and agents, packaged as a thin, opt-in, **default-off**,
**Claude-Code-only** GSD capability over Claude Code's shipped inter-agent messaging (`SendMessage` +
`ListAgents` + resume-from-transcript). **No gsd-core engine changes, and no host hook.** On any
non-Claude runtime, below the version floor, or when disabled, behaviour is byte-identical to today.

Sibling of [`gsd-handover`](https://github.com/davesienkowski/gsd-handover): handover retires
mid-phase session death; this retires guessing-instead-of-asking (escalation), transcript-spelunking
(interview), and stale learnings (doorbell).

## Why it is thin, not a build

Claude Code already ships the messaging substrate AND its security model (every inbound message is
untrusted data, wrapped with a permission-laundering guard the receiver honors). So the features here
are conventions, not code. Each was spiked to a verdict of thin glue; `capabilities/messaging/`
carries the descriptor plus the reference and template payload that GSD workflows include. It ships
`hooks: []` on purpose - escalation and the doorbell fire inside workflow turns, not host lifecycle
events, which makes it even thinner than a hook-based capability.

## What it provides

1. **Escalation + interview channel.** A blocked executor asks its orchestrator a scoped checkpoint
   question mid-flight instead of guessing, and resumes on the reply. An orchestrator can interview a
   blocked/idle/completed agent's reasoning read-only instead of parsing its transcript. Interview is
   the read-only sibling of escalation - same mechanism.
   See `capabilities/messaging/references/escalation-query-channel.md` and
   `capabilities/messaging/templates/escalation-executor-brief.md`.
2. **Learning doorbell.** After `/gsd-extract-learnings` writes the durable store, ring self-owned
   sibling sessions to re-read it now. A doorbell only; the learning itself is never sent. See
   `capabilities/messaging/references/learning-doorbell.md` and
   `capabilities/messaging/templates/doorbell-receiver-convention.md`.
3. **`/gsd-sessions` conductor view.** Read-only dashboard of your live sessions correlated with GSD
   phase state, sorted closest-to-limit first. Zero messaging risk; the safe first slice.
   `capabilities/messaging/sessions/gsd-sessions.mjs`.
4. **Trust posture.** Shipped in Claude Code; this capability configures and relies on it, does not
   reinvent it. `capabilities/messaging/references/trust-posture.md`.
5. **AFK checkpoint delegation.** An autonomous orchestrator resolves an executor's delegated
   grey-area checkpoint using a scoped decision policy, decides within bounds or escalates to a human,
   and writes every unattended decision to an append-only audit log. Since Claude Code has no platform
   sender allowlist, the audit log - not identity gating - is the accountability substrate. See
   `capabilities/messaging/references/afk-decider.md`, `templates/afk-decider.md`,
   `policy/afk-decision-policy.example.json`, and `scripts/afk-decision-log.cjs`.

## Install

    gsd capability install messaging      # from a checkout of this repo

Then enable what you want (all default-off):

    gsd config set messaging.enabled true
    gsd config set messaging.escalation.enabled true
    gsd config set messaging.doorbell.enabled true
    gsd config set messaging.afk.enabled true          # autonomous decider + audit log (advanced)

`settings.snippet.json` shows the same toggles for manual/federated config. There is no Claude Code
`settings.json` hook to register - this capability ships none.

The AFK feature also reads `messaging.afk.policy_path` (copy `policy/afk-decision-policy.example.json`
there and tune) and appends to `messaging.afk.audit_log_path`.

## Try it

    npm test                 # structural + dashboard smoke tests (dashboard tests skip without the claude CLI)
    npm run sessions         # the read-only session dashboard

`examples/walkthrough.md` reproduces the escalation, interview, and doorbell flows by hand.

## Two substrate gotchas baked into the conventions

1. Reply to an in-process subagent by its **agentId**, not its `from` name. Cross-session peers use
   `name [ref]`. An executor can always reach its spawner at the literal address `main`.
2. The doorbell ringer cannot be a standalone shell script - `SendMessage` is an agent tool, so the
   ringer runs inside an interactive session's workflow turn (background subagents lose `ListAgents`,
   Claude Code issue #853). `/gsd-extract-learnings` runs in exactly such a session.

## Design notes (from an adversarial review)

- **Zawinski's law, bounded.** Yes, this adds messaging to a non-messaging product. Justified only
  because it is default-off, claude-only, adds no core engine code, and each feature retires a named
  pain. Durable coordination (locks, intents, ledgers) belongs in `.planning` / memtrace `fleet_*`,
  not here. Messaging is a doorbell, not a database.
- **Dropped-message resilience (Hyrum).** The escalation question is surfaced twice (a `SendMessage`
  plus an `ESCALATION:` marker in the executor's completion output), so a lost message cannot
  deadlock the executor. Absent the channel, degrade to a documented best-guess default.
- **Doorbell is a both-ends feature.** A sibling without the capability enabled will not live-re-read
  (it keeps today's plan-phase-start read). Fail-open, never wrong.
- **Interview is scoped** to idle/blocked/completed agents only, never one mid-unit-of-work.

## AFK checkpoint delegation (idea #9) - the trust edge, done honestly

An autonomous executor delegating a scoped decision to a decider reuses the escalation channel. The
honest constraint, confirmed against the Claude Code docs: there is NO platform per-sender allowlist.
`crossSessionInbound` is a GLOBAL posture (`accept` / `hold` / `refuse`), not keyed to sender identity;
a message carries only the sender's session name and a reply address. So "only accept a decision from
decider X" is strong ONLY on the `main`/spawner axis (an in-process executor trusting its own
orchestrator); across sessions, per-sender trust is receiver model judgment on a weakly-authenticated
name, backed by the coarse controls `crossSessionInbound`, `isolatePeerMachines`, and
`SendMessage`/`ListAgents` deny rules.

Rather than pretend an allowlist exists, this capability makes the audit log the accountability
substrate. When `messaging.afk.enabled` is true, the decider:

1. classifies each delegated checkpoint against a scoped policy
   (`policy/afk-decision-policy.example.json`) - `auto_decidable` classes carry a `bound`, everything
   else escalates to a human;
2. writes an audit record for every decision (auto or escalated) via
   `scripts/afk-decision-log.cjs` (append-only JSONL, schema-validated, `verify` re-checks the log);
3. only then replies. No audit record, no reply.

The simplest shippable form is a HUMAN decider reachable via Remote Control - inject the RC session as
the executor's decider and keep the log on. The policy and log matter most when the decider itself is
autonomous. See `capabilities/messaging/references/afk-decider.md`.

Still out of scope: durable coordination (locks, intents, ledgers) belongs in `.planning` /
`fleet_*`, not messaging.

## Status

BETA, `0.1.0`. Validated by spike (design brief steps 4-8). MIT licensed.
