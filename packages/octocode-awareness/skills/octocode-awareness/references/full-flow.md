# Full Awareness Flow

Use this when a task asks how the Awareness CLI, skill, hooks, locks, repo context, self-reflection, and handoff system fit together. This page is the overview; each stage links to the reference that owns it.

## One Store, Many Surfaces

Awareness is a CLI-first coordination layer over one SQLite store:

```text
Agent skill -> CLI / bundled script -> runtime modules -> global awareness.sqlite3
Hooks / Pi bridge -------------------^
query / repo inject -----------------> workspace .octocode/ projections
```

The canonical store is `~/.octocode/memory/awareness.sqlite3` under the global Octocode home, scoped by `workspace_path`, optional `artifact`, `repo`, `ref`, files, and `agent_id`. It is not the same as `<repo>/.octocode/`.

- `SKILL.md` gives agents the operating loop and routes to references.
- Hooks and the Pi bridge automate the same CLI/runtime operations around lifecycle events.
- `query <view>` reads live DB views; `repo inject` refreshes workspace `.octocode/` projections.

## State Machine

`IDLE → ATTEND → CHOOSE → CLAIMED → SUBMITTED → VERIFIED → REFLECT → PROJECTED → HAND_OFF → IDLE` — skill decides when; CLI executes; hooks automate lock/run transitions. Wiki map = `.octocode/AGENTS.md` after `repo inject`.

## End-To-End Loop

| Phase | Commands | Durable effect |
|---|---|---|
| Before / Attend | `attend`, `query workboard`, `workspace status`, `memory recall`, `refinement get`, `signal list`, read `.octocode/AGENTS.md` when present | Reads repo state, other agents, active locks, lessons, gotchas, handoffs, messages, projection health, and wiki context. |
| Before / Choose | `task ready|list|show`, `plan list|show` | Selects a ready shared-plan task; avoids a duplicate “today” queue. Quick independent edits skip task claim. |
| During / Claim | `task claim`, `task heartbeat`, `lock acquire`, `lock wait`, `agent register` | Atomically claims a durable task and run, or creates a standalone run; locks exact files before edits collide. |
| During / Communicate | `signal publish|reply|ack|resolve` | Coordinates blockers, questions, claims, decisions, requests, and handoffs. |
| During / Learn (bookkeep) | `memory record`, `reflect record` | Stores durable facts discovered during the work; skip routine status. See `references/bookkeeping.md`. |
| After / Submit + Verify | `task submit`, `verify mark`, `verify audit`, `lock release` | Moves shared work through VERIFY to DONE, or verifies a standalone run. |
| After / Reflect | `reflect record` (`--fix-repo`/`--fix-harness`/`--fix-instructions`), `reflect mine-weakness`, `reflect export-harness`, `reflect developer-review` | Stores lessons, clusters failures, previews harness guidance, and collects feedback to the instruction author. |
| After / Project | `query <view>`, `repo inject` | Reads live views or regenerates workspace `.octocode/` repo context. |
| Housekeep (clean) | `maintenance digest`, `lock prune`, `memory forget`, `signal prune`, `docs staleness` | Previews or removes stale locks, old signals, redundant memories, refinements, and docs drift. See `references/bookkeeping.md`. |
| Hand off | `session capture`, `refinement set|get`, `signal publish` | Preserves unfinished state for the next run. |
Use one `agent_id` across manual commands and hooks. Set `OCTOCODE_AGENT_ID` when a host does not provide a stable id.
## Stage Deep Dives

Each transition has one owning reference — load the one you need:

- Command map, start packet, and technical rules: `references/full-flow-cli.md`.
- Plan/task versus quick-lock choice: `references/plan-task-workflow.md`.
- Locks, verification gate, signals, refinements: `references/coordination-protocol.md`.
- Hooks and host wiring (claude/codex/cursor/Pi): `references/hooks.md`.
- LLM Wiki / `.octocode/` repo context and `repo inject`: `references/repo-context-management.md`.
- Reflection, weakness mining, developer-review: `references/self-reflection-dialogue.md`, `references/developer-review.md`; recall/decay: `references/memory-recall.md`.
