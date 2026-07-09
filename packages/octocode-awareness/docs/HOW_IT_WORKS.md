# How Octocode Awareness Works

**Audience**: users, agents, and maintainers who need the plain-language model before choosing the deeper reference doc.

Octocode Awareness is a local coordination layer for AI agents running on your computer. It has one canonical SQLite store, one CLI command surface, two bundled Agent Skills, optional hooks for host automation, and generated repo-context files when a workspace should be readable without querying the DB.

Use this page for the system shape. Use [SKILLS.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/SKILLS.md) for install and command recipes, [HOOKS.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/HOOKS.md) for host-specific hook detail, and [DB.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/DB.md) for the schema.

## The Short Version

```text
agent reads skill guidance
  -> calls awareness CLI or bundled script
  -> reads/writes global awareness.sqlite3
  -> optional hooks automate lifecycle edges
  -> optional repo inject writes <workspace>/.octocode/ projections
```

The important split:

| Piece | What it is | What it owns |
|---|---|---|
| `~/.octocode/memory/awareness.sqlite3` | The canonical local SQLite DB | Plans, durable tasks, execution runs, locks, memory, verification, signals, refinements, and audit events. |
| `octocode-awareness` CLI | The executable control plane | Commands such as `attend`, `plan`, `task`, `lock`, `verify`, `signal`, `reflect`, `query`, `repo inject`, `hooks`, and `schema`. |
| `octocode-awareness` skill | The operating guide for agents | When to attend, claim, communicate, verify, reflect, refresh repo context, bookkeep (learn), housekeep (clean), and hand off. |
| `octocode-skills` skill | The meta skill for skills | Finding, installing, reviewing, linting, improving, and creating Agent Skills. |
| Hooks / Pi bridge | Automation around host lifecycle events | Auto-claim before edits, release as pending, block or remind on missing verification, brief inbox/context, and capture handoffs. |
| `<workspace>/.octocode/` | Repo context and plan narrative | Generated projections plus managed `.octocode/plan/<timestamp-name>/**` documents. |

No server is required. No external broker is required. Agents participate when they can run the CLI, run the bundled scripts, use the library API, or use a host integration wired to the same DB.

## One Store, Many Agents

Every participating local agent reads and writes the same Awareness DB:

```text
Codex session ----\
Claude Code -------> ~/.octocode/memory/awareness.sqlite3
Cursor agent -----/
Pi agent --------/
custom host -----/
```

Rows are scoped by `workspace_path`, and optionally by `artifact`, `repo`, and `ref`, so one machine-wide DB can hold separate projects without mixing their state.

This store is different from a repo's generated `.octocode/` folder:

| Location | Source of truth? | Purpose |
|---|---:|---|
| `~/.octocode/memory/awareness.sqlite3` | Yes | Durable local store shared across agents. |
| `<workspace>/.octocode/` | Mixed | Regenerate projections with `repo inject`; preserve managed `.octocode/plan/**` narrative docs. Live task state stays in SQLite. |

Treat memories, signals, and generated wiki files as leads. Current source, tests, user instructions, and fresh verification beat remembered context.

## The CLI

The CLI is the thing that actually changes Awareness state. Agent instructions and hooks should route back to it instead of inventing parallel storage.

Use the first available executable in this order:

| Context | Preferred command |
|---|---|
| Inside an installed `octocode-awareness` skill folder | `node scripts/awareness.mjs` |
| Inside this monorepo after build | `node packages/octocode-awareness/dist/bin/awareness.js` |
| Anywhere else | `npx @octocodeai/octocode-awareness` |

The main command groups are:

| Command group | Job |
|---|---|
| `attend`, `query workboard`, `workspace status` | Orient before work. |
| `plan create|list|show|join|doc|status` | Create/govern a shared objective and its narrative docs. |
| `task create|list|ready|show|claim|heartbeat|submit|release|depend` | Define dependency-aware work and let agents choose ready tasks. |
| `memory recall`, `memory record`, `memory forget` | Reuse and maintain durable lessons. |
| `lock acquire`, `lock wait`, `lock release`, `verify audit`, `verify mark` | Coordinate edits and verification. |
| `signal publish|list|reply|ack|resolve` | Message other agents and manage handoffs. |
| `refinement set|get|delete`, `session capture` | Preserve live work state for a future run. |
| `reflect record|mine-weakness|export-harness|developer-review` | Turn outcomes into human-reviewed improvement signals. |
| `query <view>`, `repo inject` | Read live DB views or generate workspace context. |
| `hooks install|check|remove`, `hook run` | Install or dispatch lifecycle automation. |
| `schema commands|json-schema|example|validate` | Discover exact command contracts. |

Run `octocode-awareness schema commands --compact` when the command map may have changed.

## Bundled Skills

The `@octocodeai/octocode-awareness` package bundles Agent Skills under `dist/skills/`. Install those folders by path; do not install the awareness skill by registry name.

```bash
npx octocode skill --add --path <awareness-package>/dist/skills/octocode-awareness --platform common --force
npx octocode skill --add --path <awareness-package>/dist/skills/octocode-skills --platform common --force
```

Use `--platform common` when you want the skill available to any compatible agent running on the machine. Use a host-specific platform such as `codex`, `claude`, `cursor`, or `pi` when you want that install target only.

### `octocode-awareness`

This is the Awareness operating skill. It tells an agent how to use the CLI before, during, and after work:

1. Attend to live state and inspect ready tasks.
2. Choose/claim a plan task when work is collaborative; otherwise use a standalone file lock.
3. Communicate through signals when coordination matters.
4. Verify declared checks before claiming success.
5. Reflect only durable lessons.
6. Project repo context with `repo inject` when future agents or humans need it.
7. Hand off unfinished state.

The skill also includes references and scripts so an installed agent can call `node scripts/awareness.mjs` without needing npm package imports from the skill folder.

### `octocode-skills`

This is the meta skill for Agent Skills. Use it when the task is about skills themselves: finding, installing, reviewing, rating, improving, creating, cleaning up, description tuning, hook review, or hook authoring.

`octocode-skills` does not own Awareness memory, locks, or signals. It owns skill quality workflow. Awareness may reveal that a skill should improve through `reflect mine-weakness` or `reflect export-harness`; `octocode-skills` is the skill to use when applying that improvement to a skill folder.

### Where `npx octocode` fits

`npx octocode` is separate from `octocode-awareness`.

| Tool | Use it for |
|---|---|
| `octocode-awareness` | Shared plans/tasks, memory, locks, signals, verification, reflection, hooks, and repo context. |
| `npx octocode` | Code/package/GitHub search and skill install/update/review operations. |

The awareness package does not vendor the Octocode search engine. Native search resolves through `npx octocode` or connected Octocode MCP tools.

## The Agent Loop

The normal workflow is:

```text
ATTEND -> CHOOSE TASK -> CLAIM -> WORK -> COMMUNICATE -> SUBMIT/VERIFY -> REFLECT -> HAND OFF
```

What happens in each phase:

| Phase | Agent action | Awareness effect |
|---|---|---|
| Attend | Run `attend --compact`, inspect workboard, recall relevant memory. | Reads live state, messages, pending verification, gotchas, lessons, and projection health. |
| Choose | Run `task ready`, then `task claim`, when participating in a plan. | Atomically leases the task and creates one linked run. Quick edits may skip this. |
| Claim | Run `lock acquire` for exact targets. | Reuses the claimed task run when unambiguous; otherwise creates a standalone run. |
| Work | Edit files. | Hooks write `edit_log` and release exact locks; a linked run stays active across edits. |
| Communicate | Publish/reply/ack/resolve signals when needed. | Keeps blockers, questions, decisions, and handoffs visible to other agents. |
| Verify | `task submit`, run checks, then `verify mark --run-id`. | Turns the run into success/failure and linked task into `DONE`/`FAILED`. |
| Reflect | Record reusable lessons, failure signatures, or harness proposals. | Writes memories, refinements, and harness log rows. |
| Project | Run `query` for live views or `repo inject` for files. | Reads DB views or refreshes workspace `.octocode/` projections. |
| Hand off | Capture session state or publish a handoff signal. | Preserves unfinished context for the next run. |

Hooks can automate parts of this loop, but the CLI and DB state remain the source of truth.

## Hooks

Hooks are optional automation over the same Awareness operations. They make the important lifecycle edges harder to skip.

| Lifecycle edge | Hook behavior | Result |
|---|---|---|
| Prompt arrives | Smart briefing | Agent registry is touched and unread signals/context can be surfaced. |
| Write tool is about to edit | Pre-edit claim | Target files are locked before the edit lands; real conflicts block. |
| Write targets awareness harness or skill files | Harness guard | Self-edits require explicit approval environment and a safe branch. |
| Write tool finished | Post-edit release | Standalone run becomes `PENDING`; a claimed-task run stays `ACTIVE` until `task submit`. |
| Agent is stopping | Verify gate | Pending verification blocks or reminds before the run concludes. |
| Session ends or compacts | Session capture | Handoff/refinement state is captured from locks and dirty files. |

Host support differs:

| Host | Hook model |
|---|---|
| Claude Code | `SKILL.md` frontmatter hooks can run when the skill is active; project-wide install uses `.claude/settings.json`. |
| Codex | Install explicit hook config with `octocode-awareness hooks install --host codex`; skill frontmatter alone is not enough. |
| Cursor | Install explicit hook config with `octocode-awareness hooks install --host cursor`; skill frontmatter alone is not enough. |
| Pi | Use `wirePiAwarenessHooks(pi)` through the Pi extension; no shell hook config. |
| Custom host | Call the library API or invoke `hook run` with host payloads. |

Preview and check shell-hook installs:

```bash
octocode-awareness hooks install --host codex --project-dir . --dry-run --compact
octocode-awareness hooks check --host codex --project-dir . --strict --compact
```

Installed is not always enabled. After installing host hooks, confirm the host actually executes them and that `OCTOCODE_AGENT_ID` is stable enough for manual commands and hooks to share one identity.

## Concept Ownership

These docs intentionally avoid one giant reference. Each page owns a different layer:

| Concept | Owner |
|---|---|
| How the CLI, bundled skills, hooks, DB, and projections fit together | This file |
| User install path and command recipes | [SKILLS.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/SKILLS.md) |
| Maintainer-facing system map and invariants | [HARNESS.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/HARNESS.md) |
| SQLite schema, rows, indexes, and query views | [DB.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/DB.md) |
| Plans/tasks/runs and DB relationships | [DB.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/DB.md) |
| File locks, run states, conflicts, verification semantics | [LOCKS.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/LOCKS.md) |
| Host hook install/debug behavior | [HOOKS.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/HOOKS.md) |
| Generated workspace `.octocode/` context | [WIKI.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/WIKI.md) |
| Reflection and self-improvement boundaries | [REFLECTION.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/REFLECTION.md) |
| Attend/workboard navigation and compact context routing | [MEMORY_NAVIGATION.md](https://github.com/bgauryy/octocode-mcp/blob/main/packages/octocode-awareness/docs/MEMORY_NAVIGATION.md) |

When adding docs, keep summaries short and link to the owner page for detail. If a concept needs more depth, split it by owner rather than repeating the same explanation in every guide.

## Quick Checks

Use these checks to confirm the system is wired:

```bash
octocode-awareness maintenance init --compact
octocode-awareness attend --workspace "$PWD" --query "smoke" --compact
octocode-awareness workspace status --workspace "$PWD" --compact
octocode-awareness schema commands --compact
```

For hooks:

```bash
octocode-awareness hooks install --host codex --project-dir . --dry-run --compact
octocode-awareness hooks check --host codex --project-dir . --strict --compact
```

For skill management:

```bash
npx octocode skill --add --path <awareness-package>/dist/skills/octocode-awareness --platform common --force
npx octocode skill --add --path <awareness-package>/dist/skills/octocode-skills --platform common --force
```
