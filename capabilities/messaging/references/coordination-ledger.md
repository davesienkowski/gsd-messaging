# The coordination ledger (the cross-capability contract)

Status: the durable source of a session's coordination edges, so a handover can carry not just the
work but the open questions and the peers. **This file is the contract** shared between gsd-messaging
(the writer) and [`gsd-handover`](https://github.com/davesienkowski/gsd-handover) (the reader). The
canonical implementation is `scripts/coordination-ledger.cjs`; gsd-handover ships a read-only copy of
`readOpen` / `renderCoordinationSection` against this same schema.

## Why a ledger, not messaging

Coordination edges are durable state. *Messaging is a doorbell, not a database* - so the fact that "I
escalated question X to peer P and I am waiting" lives in an append-only ledger under `.planning/`, and
the handover baton reads it. Without the ledger, a handover baton's `## Coordination` section is always
empty and the successor is born mute (it inherits the work but not the conversation). See the design
lacuna in the spike findings.

## Location

`messaging.coordination.ledger_path`, default `.planning/coordination.jsonl`. Append-only JSONL, one
entry per line, project-scoped.

## Entry schema

```json
{ "ts": "<ISO-8601>", "kind": "escalation" | "peer", "status": "open" | "resolved",
  "id": "<escalation id>", "question": "<text>", "address": "<peer address>",
  "role": "<peer role>", "scope": "in-session" | "cross-session", "note": "<free text>" }
```

- **escalation** - an open question this session is waiting on. `id`, `question` (on an open entry), and
  `address` (who it is waiting on) are required. Resolve it by appending a second entry with the same
  `id` and `status: "resolved"` (the question may be omitted on the resolving entry).
- **peer** - a coordination peer's `address` + `role`, so a successor can reach it by name rather than
  discovery (a background session cannot enumerate peers, Claude Code #853).

`readOpen(path)` folds the log to the current open state: an escalation is open unless a later same-id
entry resolved it; peers are deduped by address; and every open escalation's address is guaranteed to
appear in `peers` (a placeholder is synthesized if needed) so the baton's referential-integrity check
passes.

## Scope note (be honest about which edges survive a handover)

A handover fires at the SESSION level. An in-session executor->orchestrator escalation does not survive
the session's death (both die together), so the edges most worth carrying are CROSS-SESSION ones - a
question this session asked another session, or a peer it coordinates with. Record `scope` accordingly.
The successor tries to re-establish every open edge and falls back to a documented default for any that
are unreachable (e.g. an in-session address whose owner also died), so carrying an in-session edge is
harmless, just often moot.

## Who writes it

When `messaging.escalation.enabled` is on, the executor escalation convention
(`contributions/executor-escalation.md`) appends an `escalation` entry as it escalates, and a
`resolved` entry when the answer arrives. A session that opens a cross-session peer edge should append a
`peer` entry. The handover baton generator reads the ledger; it never writes it.
