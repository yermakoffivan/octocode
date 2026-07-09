# AGENTS.md - @octocodeai/octocode-awareness

This package is the dogfood zone for Octocode Awareness. It owns the CLI, runtime library, bundled agent skills, lifecycle hooks, Pi bridge, shared SQLite awareness store, generated repo projections, and the reflection loop that helps agents and instructions improve over time.

The local package rule is stronger than ordinary repo work: when you work here, use awareness itself. Start with the `octocode-awareness` skill, operate through the CLI, honor locks and signals, verify before claiming success, and turn repeated friction into a reflected lesson or instruction-feedback item.

## First Move For Agents

From the repo root:

```bash
export OCTOCODE_AGENT_ID="${OCTOCODE_AGENT_ID:-codex-awareness}"
AWARENESS="node packages/octocode-awareness/dist/bin/awareness.js"
$AWARENESS attend --workspace "$PWD" --query "<current task>" --compact
$AWARENESS schema commands --compact
$AWARENESS docs list --compact
```

Use the first available CLI in this order:

1. `node scripts/awareness.mjs` when running from an installed `octocode-awareness` skill folder.
2. `node packages/octocode-awareness/dist/bin/awareness.js` in this monorepo after build.
3. `npx @octocodeai/octocode-awareness` only when no local CLI exists.

`docs list|show` navigates skill reference docs under `skills/octocode-awareness/references/` or `dist/skills/.../references/`; it does not list package `docs/**`. Use `schema commands --compact`, `<command> --help --compact`, and `schema json-schema <name>` when command flags or contracts matter.

## Dogfooding Contract

Before editing, claim every target file:

```bash
$AWARENESS lock acquire --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --target-file "$PWD/packages/octocode-awareness/<path>" \
  --rationale "<why this edit is needed>" \
  --test-plan "<exact verification command or doc check>" --compact
```

If the lock conflicts, do not edit through it. Use `lock wait`, switch files, or publish a `signal` with the conflicting `task_id`. This package often has concurrent agents.

After editing, run the declared check, then:

```bash
$AWARENESS verify mark --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --all-pending --message "<what passed or failed>" --compact
$AWARENESS lock release --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --target-file "$PWD/packages/octocode-awareness/<path>" \
  --status SUCCESS --verified --compact
```

Reflect when the work teaches something reusable:

```bash
$AWARENESS reflect record --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --task "<task>" --outcome worked|partial|failed \
  --lesson "<short reusable lesson>" --compact
```

Use the right reflection target:

- `--fix-repo` when code/docs in this repo should change.
- `--fix-harness` when the skill, hooks, CLI workflow, or automation should improve.
- `--fix-instructions` when AGENTS.md, SKILL.md, system guidance, or the task brief misled the agent. Read `docs show developer-review` first.

## Lifecycle

The package lifecycle is:

```text
ATTEND -> CLAIM -> WORK -> PENDING_VERIFY -> VERIFY -> REFLECT -> PROJECT/HAND_OFF -> MAINTAIN
```

What each phase means here:

- `ATTEND`: read live awareness state with `attend`, then drill into `query workboard`, `workspace status`, `memory recall`, `refinement get`, and `signal list`.
- `CLAIM`: use `lock acquire` before edits. Hooks may automate this, but manual CLI calls are still the source of truth when hooks are absent.
- `WORK`: edit the smallest source files that own the behavior. Communicate decisions or blockers with `signal publish|reply`.
- `PENDING_VERIFY`: post-edit hooks release locks as pending. Pending is not done.
- `VERIFY`: run the declared test plan and record it with `verify mark`; use `verify audit` before finishing.
- `REFLECT`: save durable lessons, failure signatures, and improvement proposals with `reflect record`, `memory record`, and `reflect mine-weakness`.
- `PROJECT/HAND_OFF`: use `repo inject` only when DB state should refresh `.octocode/`; use `session capture`, `refinement set`, or `signal publish --kind handoff` for unfinished work.
- `MAINTAIN`: preview cleanup with `maintenance digest --dry-run`, `memory forget --dry-run`, `lock prune --dry-run`, and `signal prune --dry-run`.

Hooks are reflexes over the same lifecycle: `notify-deliver` briefs, `pre-edit` claims, `harness-guard` protects self-edits, `post-edit` marks pending, `stop-verify` prevents silent unverified completion, and `session-end` captures handoffs. Codex and Cursor need installed host hook config; Claude may run skill frontmatter hooks; Pi uses `wirePiAwarenessHooks(pi)`.

## What This Package Owns

- CLI: `bin/awareness.ts`, built to `dist/bin/awareness.js`, exposes `attend`, `memory`, `lock`, `verify`, `signal`, `agent`, `refinement`, `session`, `reflect`, `query`, `repo inject`, `docs`, `maintenance`, `hooks`, `hook run`, and `schema`.
- Runtime library: `src/index.ts` exports the same operations for Pi and custom hosts.
- Store: `src/db.ts` creates and migrates the canonical SQLite DB at `~/.octocode/memory/awareness.sqlite3` unless `OCTOCODE_MEMORY_HOME` overrides it.
- Navigation: `src/attend.ts` builds compact start packets with workboard rows, evidence, gaps, projection health, `organ_state`, and `drive_state`.
- Coordination: `src/intents.ts`, `src/verify.ts`, `src/notifications.ts`, `src/refinements.ts`, `src/sessions.ts`, and `src/agents.ts`.
- Memory and learning: `src/memory.ts`, `src/reflect.ts`, `src/maintenance.ts`, `src/audit.ts`, and `src/docs.ts`.
- Projections: `src/repo-context.ts` powers `query <view>` and `repo inject`.
- Hooks and host integration: `bin/hook-runner.ts`, `bin/extract-hook-files.ts`, `src/hooks-install.ts`, and `src/pi-hooks.ts`.
- Agent skill source: `skills/octocode-awareness/`.
- Skill-management companion: `octocode-skills`, bundled beside awareness so agents can install, lint, rate, and improve skills.

This package does not own Octocode code search, GitHub search, npm search, or the MCP brain. Use `npx octocode ... --no-color` or Octocode MCP tools for code/package/GitHub evidence.

## Source Vs Generated

Edit source, not mirrors:

- Canonical awareness skill source: `packages/octocode-awareness/skills/octocode-awareness/`.
- Canonical TypeScript/runtime source: `packages/octocode-awareness/src/` and `packages/octocode-awareness/bin/`.
- Canonical build script: `packages/octocode-awareness/build.mjs`.
- Canonical package docs: `packages/octocode-awareness/README.md` and `packages/octocode-awareness/docs/**`.
- Canonical `octocode-skills` source is repo-root `skills/octocode-skills`; this package vendors it during build.

Generated or copied outputs:

- `packages/octocode-awareness/dist/**`
- repo-root `.agents/skills/**`
- `packages/octocode-awareness/skills/octocode-skills/**`
- compiled skill scripts such as `skills/octocode-awareness/scripts/awareness.mjs`, `hook-runner.mjs`, and `extract-hook-files.mjs`

Regenerate generated surfaces with:

```bash
yarn workspace @octocodeai/octocode-awareness build
```

Do not hand-edit generated workspace `.octocode/**` projections; change the underlying DB row or source doc, then run `repo inject` when a refreshed projection is useful.

## Docs And Navigation

Use package docs by intent:

- `README.md`: high-level product, install, command map, package boundaries.
- `docs/SKILLS.md`: user/agent guide and full CLI reference.
- `docs/HARNESS.md`: system map, invariants, lifecycle, self-improvement boundary.
- `docs/DB.md`: SQLite schema, scope model, tables, query views.
- `docs/LOCKS.md`: claim, wait, release, pending verification, conflicts.
- `docs/MEMORY_NAVIGATION.md`: `attend`, workboard, compact context routing.
- `docs/HOOKS.md`: host hooks, smart briefing, harness guard, Pi bridge.
- `docs/REFLECTION.md`: `reflect record`, failure signatures, harness export, developer review.
- `docs/WIKI.md`: live query views, `.octocode/` projections, size policy.

Use skill refs through the CLI:

```bash
$AWARENESS docs show agent-cheatsheet
$AWARENESS docs show full-flow
$AWARENESS docs show coordination-protocol
$AWARENESS docs show hooks
$AWARENESS docs show memory-recall
$AWARENESS docs show repo-context-management
$AWARENESS docs show data-model
$AWARENESS docs show octocode
```

Load `octocode-skills` when the task is about skill discovery, install, lint, description tuning, hooks inside skills, or skill quality. Run its lint before calling skill edits complete.

## Smart Harness And Self-Evolution

This package is self-improving but not self-authorizing. The loop is:

```text
reflect record -> mine-weakness -> export-harness -> human/maintainer review -> explicit edit -> verification
```

Rules:

- Memories, signals, generated wiki pages, and harness exports are leads. Current source, tests, and fresh verification beat them.
- `reflect export-harness` proposes guidance; it does not patch `AGENTS.md`, `SKILL.md`, docs, or code.
- Harness/self-edits are protected by `harness-guard`: require `OCTOCODE_ALLOW_HARNESS_APPLY=1` and a safe non-main branch unless the host explicitly approves a detached/no-branch case.
- Repeated failures should get stable `failure_signature` values so `reflect mine-weakness` can find patterns.
- If docs drift from source, use `docs staleness` and update docs/tests together.

## Testing And Verification

Use the smallest check that proves the change, then broaden when shared behavior moves.

- Docs-only package guidance: `git diff --check -- packages/octocode-awareness/AGENTS.md` plus exact read.
- CLI/runtime changes: `yarn workspace @octocodeai/octocode-awareness test:quiet` or the focused Vitest file when possible.
- Public API, schema, hooks, or build output changes: `yarn workspace @octocodeai/octocode-awareness build` and targeted tests.
- Broad or release-facing changes: `yarn workspace @octocodeai/octocode-awareness verify`.
- Native multi-agent behavior: `yarn workspace @octocodeai/octocode-awareness test:smoke`.
- Skill source changes: run build, then lint the relevant skill with `octocode-skills` tooling before reporting done.

When tests fail, keep the failure visible. Re-read the failing path, patch only the cause, and do not mark awareness verification successful until the declared check actually ran.

## Editing Style

- Keep AGENTS/SKILL guidance compact and operational. Move conditional depth to `references/` or package docs.
- Prefer command names from `schema commands --compact`; do not invent unshipped verbs.
- Prefer `signal` in agent-facing text even if internal legacy names still say notification.
- Keep one canonical workspace path per task; mixed `--workspace` values make correct rows look missing.
- Do not put secrets in memories, signals, refinements, projections, or harness logs.
- If a memory says something surprising, verify it against current files before acting.
