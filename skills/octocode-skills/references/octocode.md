# Octocode Research Delegation

Load when skill discovery or comparison needs GitHub, package, or code research. Why: this skill judges/installs skills — it does not own Octocode research rules.

Use `octocode-research` for router, tool choice, evidence grades, citations, and MCP/CLI fallback.

1. IF `octocode-research` is installed THEN load it and request skill-candidate discovery or exact `SKILL.md` evidence.
2. If not: point to https://github.com/bgauryy/octocode/tree/main/skills/octocode-research
3. Install: `npx octocode skill --name octocode-research` (add `--platform <host>` for a specific host).

Return found skill folders here for review, quality scoring, adaptation, install gating, and recommendations.

Next: when fanning out load `references/search-playbook.md`; after inspection load `references/quality-rubric.md`.
