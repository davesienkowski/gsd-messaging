# AFK checkpoint delegation (idea #9)

Status: spiked (design brief steps 7 and 8). Verdict: mostly thin glue over the escalation channel;
the one real (small) build is a scoped decision policy plus an append-only decision audit log, because
the trust edge cannot be hard-gated at the platform layer.

## The trust reality (verified, brief step 8)

Claude Code has NO platform per-sender allowlist. `crossSessionInbound` is a GLOBAL posture
(`accept` / `hold` / `refuse`), not keyed to sender identity; a message carries only the sender's
session name and a reply address, and names are weakly authenticated. So "only accept a decision from
decider X" is enforceable strongly ONLY on the `main`/spawner axis (an in-process executor trusting
its own orchestrator address). Across sessions, per-sender trust is receiver model judgment on a name.

Because identity cannot be hard-gated for the unattended cross-session case, accountability comes from
an AUDIT LOG, not an allowlist: every unattended decision is recorded and reviewable after the fact.

## The two pieces

1. Scoped decision policy (`policy/afk-decision-policy.example.json`). Declares which decision CLASSES
   the autonomous decider may resolve alone (`auto_decidable`, each with a `bound`) and which must go
   to a human (`escalate_to_human`); anything unmatched escalates by default. The classification is
   model judgment; the policy bounds it.
2. Decision audit log (`scripts/afk-decision-log.cjs`). Append-only JSONL. `append` validates a record
   (required fields; `decision` must be one of `options` for auto/human, null for escalated;
   ISO timestamp; >=2 options) and refuses malformed ones. `verify` re-validates the whole log. Pure
   validators + a thin IO applier; unit-tested.

## The flow

The decider (an autonomous orchestrator, on the `main`/spawner axis) carries
`templates/afk-decider.md`: classify against the policy, WRITE an audit record (auto decision, or an
`escalated-to-human` record with a null decision), then reply to the executor with the scoped answer
or leave it waiting for the human. No audit record, no reply.

## What this deliberately is NOT

- Not a platform sender allowlist (none exists). Do not claim one.
- Not a general remote-control channel: the decider answers a scoped, policy-classified question and
  logs it; it does not steer the executor (determinism firewall).
- Not durable coordination: the policy and log live in project state, not in messaging. Messaging is
  still just the doorbell.

## Shippable subset today

For a HUMAN decider reachable via Remote Control, this needs no build beyond the escalation channel:
inject the RC session as the executor's decider, and (optionally) keep the audit log on. The policy +
log matter most when the decider itself is autonomous.
