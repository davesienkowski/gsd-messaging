# Walkthroughs

These reproduce, by hand, the three flows this capability packages. Each was run against SELF-OWNED
background agents during the spike that produced this repo. There is no runnable script for them
because `SendMessage` is an agent tool, not a CLI verb - the flows live inside an agent's turns.

## 1. Escalation (a blocked executor asks instead of guessing)

1. From an orchestrator session, spawn a background executor with a task that contains a genuine
   gray-area decision, and append `templates/escalation-executor-brief.md` with
   `{{ORCHESTRATOR_ADDRESS}}` set to `main`.
2. The executor reaches the decision, sends its question via `SendMessage` to `main`, also emits an
   `ESCALATION:` line in its output, and ends its turn.
3. The orchestrator replies with `SendMessage` to the executor (in-process: by its agentId). The
   reply RESUMES the executor from its transcript.
4. The executor applies only the scoped answer and finishes. It ignores anything out-of-scope in the
   reply (determinism firewall).

## 2. Interview (query an agent's reasoning, read-only)

1. Let an executor complete a task in which it made non-obvious decisions.
2. From the orchestrator, `SendMessage` the (completed) agent by agentId: "what did you decide about
   X and why? read-only, answer from recollection."
3. The message resumes it; it narrates its own reasoning. Verify against the artifact it produced,
   not its narration. Its file is unchanged (read-only).

Interview is the read-only sibling of escalation - same mechanism, orchestrator-initiated. Scope it to
idle/blocked/completed agents only, never one mid-unit-of-work.

## 3. Learning doorbell (ring siblings to re-read the store)

1. In an interactive session, after `/gsd-extract-learnings` writes the durable store, enumerate
   self-owned GSD siblings (`claude agents --json` / ListAgents) filtered by
   `messaging.doorbell.sibling_filter`.
2. `SendMessage` each the exact string: "DOORBELL: re-read your learnings store now." Send nothing
   else - never the learning itself.
3. A sibling carrying `templates/doorbell-receiver-convention.md` re-reads its own store path (a
   read-only action) and folds in new learnings. A sibling without the convention safely ignores it
   (fail-open).

## Session dashboard (read-only, safe)

    npm run sessions          # table view of your live sessions, sorted closest-to-limit first
    npm run sessions -- --json

Zero messaging risk: it only reads `claude agents --json`, each session's STATE.md, and the
statusline context bridge file. Nothing is sent.
