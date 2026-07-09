# Agent Cheat Sheet

Use `<cli>` below as the first available Awareness CLI: `node scripts/awareness.mjs` in an installed skill, `node packages/octocode-awareness/dist/bin/awareness.js` in this monorepo, then `npx @octocodeai/octocode-awareness`. Set `OCTOCODE_AGENT_ID` once per run.

## Start

```bash
<cli> attend --workspace "$PWD" --query "<current task>" --compact
<cli> schema commands --compact
<cli> docs list --compact
```

Follow `next` from `attend` when present — it is meant to be copy-runnable.
Use `<command> --help --compact` for flags, `schema json-schema <name> --compact` for contracts, and `docs show <name>` for focused reference docs.

## Operations Map

| Need | Commands |
|---|---|
| Start context | `attend`, `query workboard`, `workspace status`, `memory recall` |
| Claim/edit | `lock acquire`, `lock wait`, `lock release` |
| Coordinate | `signal publish|list|reply|ack|resolve`, `refinement set|get` |
| Learn | `memory record`, `reflect record --duo`, `reflect mine-weakness` |
| Verify | `verify audit`, `verify mark`, `lock release --verified` |
| Project repo context | `query <view>`, `repo inject` |
| Install/enforce | `maintenance init`, `hooks install|check|remove`, `agent register` |
| Cleanup | `maintenance digest`, `lock prune`, `signal prune`, `memory forget --dry-run` |

## Before edits

```bash
<cli> workspace status --workspace "$PWD" --compact
<cli> memory recall --query "<task>" --workspace "$PWD" --smart --compact
<cli> refinement get --workspace "$PWD" --state open --compact
<cli> signal list --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" --compact
<cli> lock acquire --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --target-file <path> --rationale "<why>" --test-plan "<exact verify>" --compact
```

Exit code `2` on lock conflict → wait, coordinate via signal, switch files, or stop.

## After edits

```bash
<cli> verify audit --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" --compact
# run the declared test plan, then:
<cli> verify mark --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" --all-pending --compact
<cli> lock release --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --status SUCCESS --verified --compact
```

## Finish / hygiene

```bash
<cli> reflect record --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --task "<task>" --outcome worked|partial|failed --lesson "<reusable>" --compact
# route feedback by target: --fix-repo <code>, --fix-harness <tooling>,
# --fix-instructions <what the AGENTS.md/SKILL/brief should have said>
<cli> reflect developer-review --workspace "$PWD" --format markdown --compact  # read instruction feedback
<cli> session capture --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" --compact
<cli> maintenance digest --workspace "$PWD" --dry-run --compact
<cli> repo inject --workspace "$PWD" --compact   # only when projections should refresh
# then: if root AGENTS.md has no pointer to .octocode/AGENTS.md, append the short
# block from references/repo-context-management.md (do not rewrite the whole file)
```

## Hard ideas

```bash
<cli> attend --workspace "$PWD" --query "<idea or risk>" --compact
# then read references/self-reflection-dialogue.md and run a bounded two-role pass
<cli> reflect record ... --duo --compact   # advisory supporter/skeptic prompts only
```

## Handoffs

```bash
<cli> refinement get --workspace "$PWD" --state open --compact
# handoff_count > 0 means session handoffs exist; list them with:
<cli> refinement get --workspace "$PWD" --state open --include-handoffs --compact
```

## Agents + docs

```bash
<cli> agent register --agent-id "$OCTOCODE_AGENT_ID" --agent-name "<host>" --workspace "$PWD" --compact
<cli> agent list --workspace "$PWD" --compact
<cli> docs list --compact
<cli> docs show full-flow
<cli> docs staleness --targets-json '[{"docFile":"README.md","sourceDirs":["src"]}]' --compact
```

`docs list|show` indexes skill `references/*.md` only (not package `docs/**`).


## Skills (install / update / lint)

Sibling skill `octocode-skills` ships next to this skill in the awareness package bundle. Use `npx octocode` for skill install/update/lint and for Octocode research/search operations — gate every write.

```bash
# Install / refresh both bundled skills for a host; use common for ~/.agents/skills
npx octocode skill --add --path "<awareness-package>/dist/skills/octocode-awareness" --platform codex --force
npx octocode skill --add --path "<awareness-package>/dist/skills/octocode-skills" --platform codex --force

# Initialize store and smoke the CLI
<cli> maintenance init --compact
<cli> attend --workspace "$PWD" --query "smoke" --compact

# Hooks: preview first, install after approval, then verify host wiring
<cli> hooks install --host codex --project-dir "$PWD" --dry-run --compact
<cli> hooks install --host codex --project-dir "$PWD" --compact
<cli> hooks check --host codex --project-dir "$PWD" --strict --compact

# Lint this skill (from an installed awareness skill folder)
node ../octocode-skills/scripts/skill-lint.mjs .
# Or from the package tree after build:
node packages/octocode-awareness/skills/octocode-skills/scripts/skill-lint.mjs \
  packages/octocode-awareness/skills/octocode-awareness
```

Load `octocode-skills` when the job is skill discovery/install/lint; keep using this skill for workspace awareness. Do not install `octocode-awareness` by registry name: the `@octocodeai/octocode-awareness` package already bundles the canonical skill.

## Code search (not bundled here)


```bash
npx octocode search <dir> --tree --max-depth 2 --no-color
npx octocode search "<term>" <path> --no-color
npx octocode search <file> --content-view exact --no-color
```

Use `npx octocode` so the platform-native engine resolves correctly. Details: `references/octocode.md`.

## Rules of thumb

- SQLite is canonical; `.octocode/` markdown is a projection/lead.
- Memories and signals are leads — verify against files/tests before acting.
- Prefer `signal` vocabulary in docs/CLI; internal `notification*` names are aliases.
- Do not invent unshipped commands (`sleep`, dedicated trust gate) — see `homeostatic-loop.md`.
