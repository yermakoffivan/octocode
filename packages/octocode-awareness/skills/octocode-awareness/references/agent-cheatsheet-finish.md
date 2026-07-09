# Agent Cheat Sheet — Finish & Handoffs

Core loop: `references/agent-cheatsheet.md`. Agents/skills/search: `references/agent-cheatsheet-tooling.md`.

## Finish / hygiene

```bash
<cli> reflect record --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" \
  --task "<task>" --outcome worked|partial|failed --lesson "<reusable>" --compact
# route feedback by target: --fix-repo <code>, --fix-harness <tooling>,
# --fix-instructions <what the AGENTS.md/SKILL/brief should have said>
<cli> reflect developer-review --workspace "$PWD" --format markdown --compact  # read instruction feedback
<cli> session capture --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" --compact
<cli> maintenance digest --workspace "$PWD" --dry-run --compact
<cli> query files --workspace "$PWD" --format table --limit 50  # stale/missing refs
<cli> query all --workspace "$PWD" --format html --out .octocode/awareness/index.html
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

## Rules of thumb

- SQLite is canonical; `.octocode/` markdown is a projection/lead.
- Memories and signals are leads — verify against files/tests before acting.
- Prefer `signal` vocabulary in docs/CLI; internal `notification*` names are aliases.
- Do not invent unshipped commands (`sleep`, dedicated trust gate) — see `homeostatic-loop.md`.
