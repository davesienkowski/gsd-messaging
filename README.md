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
   **This one auto-fires:** when `messaging.escalation.enabled` is true, the executor instructions
   (`contributions/executor-escalation.md`) are injected automatically into every gsd-executor at the
   `execute:wave:pre` loop point via a capability contribution - no manual wiring, no gsd-core edit.
   Validated against gsd-core's own `validateCapability` (0 errors). See also
   `references/escalation-query-channel.md` and `templates/escalation-executor-brief.md`.
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

## Install and enable

Install from the repo (declarative-only - it ships **no executable hook**, so there is no consent
prompt, unlike a hook-based capability):

```
gsd capability install https://github.com/davesienkowski/gsd-messaging --scope global --yes
# or from a local checkout:
gsd capability install <path-to-repo>/capabilities/messaging --scope global --yes
```

Then enable the master toggle **and** the feature you want. **Both are required** - the escalation
contribution stays inactive until `messaging.enabled` **and** `messaging.escalation.enabled` are both
true:

```
gsd-tools capability set messaging --gate messaging.enabled=true --gate messaging.escalation.enabled=true --scope global
```

`--gate` only accepts booleans. Non-boolean keys (paths, globs) are set as config values, which write
to `~/.gsd/defaults.json` (global) or a project's `.planning/config.json`:

```
gsd-tools config set messaging.afk.policy_path ~/.gsd/afk-decision-policy.json
```

### Verify it is active

```
gsd-tools capability state --raw     # find "messaging" -> active: true
gsd-tools loop render-hooks execute:wave:pre --raw   # output should contain the escalation fragment
```

When active, every gsd-executor gets the escalation + interview instructions at the start of each
execute-phase wave, in **all** your sessions, at their next `/gsd-execute-phase` (loop hooks render
fresh each run - no per-session step). The capability lives in `~/.gsd/capabilities/messaging/` and
**survives a gsd-core reinstall**. Remove with `gsd-tools capability remove messaging`.

### What installing does - and does NOT - wire

Installing + enabling makes **escalation and interview** auto-fire (a loop-point contribution into the
executor). It does **not** wire the **doorbell** or **AFK** behaviors: those must fire from GSD
workflows (`/gsd-extract-learnings`, `/gsd-autonomous`) that a capability *cannot* edit. This repo
ships their conventions, receiver template, policy, and the audit-log tool; making them fire requires
a workflow-wiring step (a local runtime mod that patches those two workflows, or an upstream gsd-core
change). Until you do that, the doorbell and AFK are documented, tested patterns you or your
orchestrator invoke - not automatic behaviors. Escalation is the one that is turnkey.

### Config keys

All default-off / safe. Set booleans with `capability set --gate` or `config set`; set the rest with
`config set` (or edit `~/.gsd/defaults.json` / `.planning/config.json`).

| Key | Type | Default | What it does |
|---|---|---|---|
| `messaging.enabled` | bool | `false` | Master toggle. Everything is inert until this is true. |
| `messaging.escalation.enabled` | bool | `false` | Auto-inject the escalation + interview instructions into the executor. |
| `messaging.doorbell.enabled` | bool | `false` | Gate for the learning doorbell (needs the workflow-wiring step above). |
| `messaging.doorbell.sibling_filter` | string | `gsd-*` | Which self-owned session names receive a doorbell. Bounds the blast radius. |
| `messaging.afk.enabled` | bool | `false` | Gate for AFK checkpoint delegation (needs the workflow-wiring step above). |
| `messaging.afk.policy_path` | string | `.planning/afk-decision-policy.json` | The scoped decision policy the AFK decider classifies against. Copy `policy/afk-decision-policy.example.json` and tune. |
| `messaging.afk.audit_log_path` | string | `.planning/afk-decisions.jsonl` | Append-only log of every unattended decision. Review with `scripts/afk-decision-log.cjs verify`. |
| `messaging.min_claude_code_version` | string | `2.1.224` | Version floor; fails closed below it. |

## Try it

    npm test                 # structural + dashboard smoke tests (dashboard tests skip without the claude CLI)
    npm run sessions         # the read-only session dashboard

`examples/walkthrough.md` reproduces the escalation, interview, and doorbell flows by hand.

## The `/gsd-sessions` dashboard - seeing and attaching to sessions

`capabilities/messaging/sessions/gsd-sessions.mjs` is a **read-only** conductor view of every Claude
Code session on this machine, correlated with each one's GSD phase and remaining-context %, **sorted
closest-to-limit first**. It only reads (`claude agents --json`, each session's `STATE.md`, the
statusline context bridge); it never sends a message.

```
npm run sessions                 # table view
npm run sessions -- --json        # JSON, for scripting
# or directly, from anywhere:
node <path-to-repo>/capabilities/messaging/sessions/gsd-sessions.mjs
```

It pairs naturally with [`gsd-handover`](https://github.com/davesienkowski/gsd-handover): the row
nearest its watermark is the one about to hand off, and the successor shows up as a `background`
session named `gsd-handover-<phase>`.

### Native ways to see your sessions

The dashboard is a convenience over Claude Code's own commands, which you can always use directly:

```
claude agents                    # interactive agent view: watch/monitor all background + interactive sessions
claude agents --json              # same, as JSON (rows carry id, name, sessionId, kind, state, cwd)
claude agents --json --all        # also include completed sessions
claude agents --cwd ~/path/to/repo   # only sessions started under a directory
```

### Attach to a background session (e.g. a handover successor)

```
claude --resume <sessionId>       # attach to a specific session from a shell
claude --resume                    # or open the interactive picker and choose it
```

Or, from **inside** a running Claude Code session, type the `/resume` slash command to open the same
picker and switch without leaving your terminal. Attaching is optional - a background session keeps
running whether or not you attach.

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
