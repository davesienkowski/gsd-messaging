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

## Install

    gsd capability install messaging      # from a checkout of this repo

Then enable what you want (all default-off):

    gsd config set messaging.enabled true
    gsd config set messaging.escalation.enabled true
    gsd config set messaging.doorbell.enabled true

`settings.snippet.json` shows the same toggles for manual/federated config. There is no Claude Code
`settings.json` hook to register - this capability ships none.

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

## Not here (yet): AFK checkpoint delegation (idea #9)

An autonomous executor delegating a scoped decision to a designated decider reuses the escalation
channel, and for a human-decider-via-Remote-Control target it is shippable on top of what is here. The
fully-autonomous-decider case is a small follow-on build that hardens the trust edge: a
config-enforced sender allowlist (Claude Code `crossSessionInbound` allow/deny by sender identity, not
receiver model judgment alone), a scoped decision policy, and an AFK decision audit log. It is
deliberately not in this default-off thin release.

## Status

BETA, `0.1.0`. Validated by spike; see the design brief that produced it. MIT licensed.
