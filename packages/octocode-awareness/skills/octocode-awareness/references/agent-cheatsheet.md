# Agent Cheat Sheet

Use `<cli>` below as the first available Awareness CLI: `node scripts/awareness.mjs` in an installed skill, `node packages/octocode-awareness/dist/bin/awareness.js` in this monorepo, then `npx @octocodeai/octocode-awareness`. Set `OCTOCODE_AGENT_ID` once per run. More recipes: `references/agent-cheatsheet-finish.md` (finish/handoffs) and `references/agent-cheatsheet-tooling.md` (agents/skills/search).

## Start

```bash
<cli> attend --workspace "$PWD" --query "<current task>" --compact
<cli> schema commands --compact
<cli> docs list --compact
```

Follow `next` from `attend` when present — it is copy-runnable. For flags use `<command> --help` (add `--compact` only for a token-light line), `schema json-schema <name>` for contracts, `docs show <name>` for references.

## Operations Map

| Need | Commands |
|---|---|
| Start context | `attend`, `query workboard`, `workspace status`, `memory recall` |
| Claim/edit | `lock acquire`, `lock wait`, `lock release` |
| Coordinate | `signal publish|list|reply|ack|resolve`, `refinement set|get` |
| Learn | `memory record`, `reflect record --duo`, `reflect mine-weakness` |
| Verify | `verify audit`, `verify mark`, `lock release --verified` |
| Project repo context | `query files`, `query workboard`, `query all --format html`, `repo inject` |
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
