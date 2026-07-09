---
name: octocode-awareness
description: "Use when shared-repo coordination, multi-agent plans/tasks, taskless locks/signals, run verification, memory/wiki, hooks, reflection/evals, maintenance, or reviewing or editing this package requires packages/octocode-awareness dogfooding or Octocode skill/research routing."
hooks:
  PreToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit|apply_patch|ApplyPatch", hooks: [{ type: command, command: "${CLAUDE_SKILL_DIR}/scripts/hooks/pre-edit.sh", timeout: 20 }, { type: command, command: "${CLAUDE_SKILL_DIR}/scripts/hooks/harness-guard.sh", timeout: 20 }] }]
  PostToolUse: [{ matcher: "Write|Edit|MultiEdit|NotebookEdit|apply_patch|ApplyPatch", hooks: [{ type: command, command: "${CLAUDE_SKILL_DIR}/scripts/hooks/post-edit.sh", timeout: 20 }] }]
  Stop: [{ hooks: [{ type: command, command: "${CLAUDE_SKILL_DIR}/scripts/hooks/stop-verify.sh", timeout: 20 }] }]
  SubagentStop: [{ hooks: [{ type: command, command: "${CLAUDE_SKILL_DIR}/scripts/hooks/stop-verify.sh", timeout: 20 }] }]
  SessionEnd: [{ hooks: [{ type: command, command: "${CLAUDE_SKILL_DIR}/scripts/hooks/session-end.sh", timeout: 20 }] }]
  UserPromptSubmit: [{ hooks: [{ type: command, command: "${CLAUDE_SKILL_DIR}/scripts/hooks/notify-deliver.sh", timeout: 20 }] }]
---
# Octocode Awareness
Use for shared-repo awareness across the agent lifecycle: sense -> attend -> choose -> claim -> act -> submit/verify -> reflect -> hand off/project -> maintain.
Choose `<cli>` in order: `node scripts/awareness.mjs` inside an installed skill; `node packages/octocode-awareness/dist/bin/awareness.js` in this monorepo; `npx @octocodeai/octocode-awareness` only when no local CLI exists. Canonical store: global `~/.octocode/memory/awareness.sqlite3`; `<repo>/.octocode/` is generated, not the DB.
First command: `<cli> attend --workspace "$PWD" --query "<current task>" --compact`. Inspect Ready/Claimed/Verify before inventing work: claim a matching shared-plan task, or use a standalone lock for an unrelated quick edit. Then use `schema commands`, `docs list|show`, and `references/agent-cheatsheet.md` for recipes.

## Before / During / After
- **Before**: `attend`; inspect workboard Ready/Claimed/Verify and `task ready|list`; claim shared-plan work with `task claim`, or choose the taskless lock flow for a quick independent edit. See `references/plan-task-workflow.md`. Check recall/refinements/signals; load `references/octocode.md` before code/package/GitHub evidence.
- **During**: lock exact files; pass the claimed task's `run_id`, or omit task/run for a standalone lock. Use `task heartbeat|submit|release|depend`, `lock wait|release`, `signal publish|reply|ack|resolve`, agents, and refinements. Record only durable facts in memory.
- **After**: submit and verify plan work, or release and verify a standalone run; then `verify audit`. Route reflection, preview maintenance, prune stale coordination, capture handoffs, and inject repo context when useful.
- **Ongoing**: bookkeeping (learning) and housekeep (cleanup) are recurring, workboard-driven duties — see `references/bookkeeping.md`. `docs staleness` for drift.
- **Setup**: `hooks install|check|remove`, and `npx octocode` / `octocode-skills` for skill and research operations.
## Command Map
Source of truth: `<cli> schema commands --compact`; use `<command> --help` for flags (add `--compact` only for a token-light example — it omits the flag list) and `schema json-schema <name>` for contracts.
Read `references/output-routing.md` when choosing live/durable/generated output; use `query files` for stale refs, workboard for actions, HTML for humans; read `references/agent-cheatsheet.md` for recipes, `full-flow.md` for lifecycle, and `hooks.md` for host effects.

## Must-Know
- Agents load root `AGENTS.md` by default. After `repo inject`, append a short pointer there to `.octocode/AGENTS.md` if missing — never rewrite the whole file or dump the wiki into root.
- Recall is lexical FTS + salience by default. `--semantic` ranks only when `OCTOCODE_EMBED_CMD` is set; otherwise it warns and stays lexical.
- Code/GitHub/package search and Octocode skill operations use `npx octocode ... --no-color` (or Octocode MCP for research). This skill bundles awareness docs/scripts, not the Octocode search engine.
- Read `references/learning-loop.md` when outcomes should change code/harness/instructions; use `self-reflection-dialogue.md` for internal role challenge and `subagent-rubber-duck.md` when a real second agent should independently restate/check the reasoning. Route fixes by target.
- `query workboard` is your bookkeeping/housekeep queue: `stale_file_refs` and memory-review rows are upkeep due now. Drain them (supersede/forget, prune) before concluding; dry-run mutations first. See `references/bookkeeping.md`.
- Dogfood with `attend`, locks, signals, and verified work; use `--fix-instructions` when guidance fails. Export one `OCTOCODE_AGENT_ID` for CLI+hooks; before hooks read `hooks.md`: Codex/Cursor/Pi need host wiring and installed does not mean enabled.

## References
- Map/navigation: `references/architecture.md` — high-level architecture, lifecycle→reference routing, outputs (written/read), cleanup/homeostasis, and the refine-and-improve mandate. Start here when unsure which reference to open.
- Lifecycle/CLI: `references/agent-cheatsheet.md` for recipes, `references/agent-cheatsheet-finish.md` for finish/handoffs, `references/agent-cheatsheet-tooling.md` for agents/skills/search; `references/full-flow.md` for the loop, `references/full-flow-cli.md` for commands, `references/homeostatic-loop.md` for cleanup intuition, and `references/drive-state.md` when attend returns goals/gaps/leads.
- Bookkeeping/housekeep: read `references/bookkeeping.md` when upkeep is due; it routes to `learning-loop.md` (learning) and `homeostatic-loop.md` (cleanup).
- Memory/learning: `references/memory-recall.md` before recall/record/forget; `references/memory-ranking.md` when recall surprises; `references/learning-loop.md` to close outputs; `references/self-reflection-dialogue.md` for internal roles; `references/subagent-rubber-duck.md` for a real second-agent check; `references/developer-review.md` before instruction feedback.
- Coordination: `references/plan-task-workflow.md` to choose plan task versus quick lock; `references/files-awareness.md` on collisions; `references/lock-protocol.md` before lock/verify; `references/coordination-protocol.md` before signals/refinements; `references/session-observability.md` for timestamps or handoffs.
- Hooks: `references/hooks.md` before install/check/remove; `references/hook-semantics.md` when debugging identity, TTL, payloads, or host events.
- Output/projection/schema/search: `references/output-routing.md` to choose an output; `references/repo-context-management.md` before projection; `references/data-model.md` / `references/data-model-entities.md` / `references/data-model-relationships.md` for storage; `references/octocode.md` before research.
- Skill create/improve/update: read `references/skill-evolution.md` before bounded skill edits and held-out review through bundled `octocode-skills`.
## Installation / Init Flow
1. Install/refresh this skill from the awareness package bundle, not by registry name: `npx octocode skill --add --path <awareness-package>/dist/skills/octocode-awareness --platform <host> --force` plus sibling `<awareness-package>/dist/skills/octocode-skills`; `common` installs to `~/.agents/skills`.
2. Smoke: `<cli> maintenance init --compact`; then `attend --workspace "$PWD" --query "smoke" --compact`, `workspace status`, `schema commands`, and `docs list`.
3. Hooks: preview `hooks install --host codex|cursor|claude --project-dir <repo> --dry-run --compact`; after approval run install, then `hooks check --host <host> --strict --compact`. Pi is wired by extension.
4. Repo context: run `repo inject --workspace "$PWD" --mode local --compact` only when projections should refresh; then ensure root `AGENTS.md` points to `.octocode/AGENTS.md`.
5. Skill-dir scripts are build copies: use `scripts/awareness.mjs` for CLI, `scripts/schema.mjs` for contracts, `scripts/hook-runner.mjs` for dispatch, `scripts/extract-hook-files.mjs` for payloads, `scripts/install.mjs` for install shape, `scripts/smoke-multi-agent.mjs` for smoke, and legacy `scripts/install-hooks.mjs` only for compatibility. Rebuild instead of hand-editing.
