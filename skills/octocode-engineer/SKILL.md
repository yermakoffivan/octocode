---
name: octocode-engineer
description: "Use for codebase understanding, implementation, bug investigation, refactor planning, PR/local diff review, architecture review, blast-radius analysis, and RFC/design validation. A lean router that selects the right Octocode references and evidence path: local tools, GitHub/npm, binary/archive inspection, AST, LSP, history, review workflows, quality checks, and artifact templates."
---

# Octocode Engineer

Use this skill to understand, review, or change code without guessing. The skill itself is the **router**; detailed playbooks live in `references/`. First identify the scenario, then read the smallest set of references that covers the evidence you need. Some tasks require several references — combine them deliberately instead of over-reading.

## 1. Pick the reference set first

Start with the primary reference, then add companions only when the scenario needs them.

| Task / question | Read |
|---|---|
| Local code research, implementation tracing, symbol lookup, AST/LSP, `matchString`, minify, pagination | [`references/research_local.md`](./references/research_local.md) |
| Archives, compressed files, `.node`/`.wasm`/native binaries, unzip/unpack then inspect | [`references/research_binary.md`](./references/research_binary.md) |
| GitHub/npm research, cross-repo comparison, package source lookup, PR/commit history, clone handoff | [`references/research_external.md`](./references/research_external.md) |
| CLI ↔ MCP command names and flags | [`references/context_cli_mcp_commands.md`](./references/context_cli_mcp_commands.md) |
| AST pattern examples and structural-search gotchas | [`references/context_ast_pattern_cookbook.md`](./references/context_ast_pattern_cookbook.md) |
| External metrics/checkers (`dep-cruiser`, `knip`, `type-coverage`, `eslint`, `ruff`, `mypy`) | [`references/context_external_measurement_tools.md`](./references/context_external_measurement_tools.md) |
| General engineering research recipes: orientation, blast radius, dead export, refactor, review | [`references/workflow_engineering_research.md`](./references/workflow_engineering_research.md) |
| PR review, local diff review, staged changes, safe-to-merge, history review | [`references/workflow_pr_local_review.md`](./references/workflow_pr_local_review.md) |
| Large PR / large local diff parallel review | [`references/workflow_review_parallel_strategy.md`](./references/workflow_review_parallel_strategy.md) |
| Validate or dismiss a finding | [`references/workflow_validation_playbooks.md`](./references/workflow_validation_playbooks.md) |
| Quality and review domain checklists | [`references/checklist_quality_signals.md`](./references/checklist_quality_signals.md), [`references/checklist_review_domains.md`](./references/checklist_review_domains.md) |
| Final artifact/report shape | [`references/template_artifact_report.md`](./references/template_artifact_report.md), [`references/template_review_report.md`](./references/template_review_report.md) |

## 2. Combine references by scenario

| Scenario | Reference set |
|---|---|
| Trace local behavior or implement a local change | `research_local.md` + `workflow_engineering_research.md`; add `template_artifact_report.md` for non-trivial output |
| Review local/staged changes | `workflow_pr_local_review.md` + `research_local.md` + `checklist_review_domains.md` + `template_review_report.md` |
| Review a remote PR | `workflow_pr_local_review.md` + `research_external.md` + `checklist_review_domains.md` + `template_review_report.md`; add `research_local.md` after clone |
| Compare external libraries/repos | `research_external.md`; add `research_local.md` after clone and `context_ast_pattern_cookbook.md` if comparing code shapes |
| Inspect archive/binary package contents | `research_binary.md`; after `unpack`, continue with `research_local.md` |
| Architecture/refactor risk | `workflow_engineering_research.md` + `research_local.md` + `checklist_quality_signals.md`; add `context_external_measurement_tools.md` only when a metric/graph number matters |
| Suspicious quality/security finding | `checklist_quality_signals.md` + `workflow_validation_playbooks.md`; add `context_ast_pattern_cookbook.md` for AST proof |
| Need exact syntax for any command/tool | `context_cli_mcp_commands.md` plus the workflow/reference for the task |

## 3. Fast routing

- **Already on disk** → start `research_local.md`.
- **Remote repo/package** → start `research_external.md`; clone and switch to local when analysis spans several files or needs AST/LSP.
- **Archive/binary** → start `research_binary.md`; unpack before local code research.
- **PR or local diff review** → start `workflow_pr_local_review.md` and add review checklist/template.
- **Architecture/refactor/bug investigation** → start `workflow_engineering_research.md`, then add the relevant research reference.
- **Quality smell or suspected issue** → start checklist, then validation playbook.
- **Exact CLI/MCP syntax** → use `context_cli_mcp_commands.md`.

## 4. Minimal operating loop

1. State the goal and current scope in one line.
2. Read the matching reference above.
3. Map before reading: structure/file discovery first, then exact slices.
4. Use AST for code shape; use LSP for symbol identity and blast radius.
5. Treat snippets as leads. Re-anchor with `matchString`, line ranges, AST, LSP, or history before citing.
6. Mark confidence: `confirmed`, `likely`, or `uncertain`.
7. Stop and ask when the scope, contract, blast radius, or safest fix needs a user decision.

## 5. Evidence shortcuts

| Need | Evidence path |
|---|---|
| Unknown tree | `ls/localViewStructure` → `find/localFindFiles` |
| Unknown file | `cat/localGetFileContent minify:"symbols"` |
| Exact quote/line | `matchString` + `minify:"none"` |
| Code shape | `ast` / `localSearchCode(mode:"structural")` |
| Definition/usages/call flow | `lsp` / `lspGetSemantics` with real lineHint |
| Remote proof | `ghGetFileContent(matchString)`; clone for AST/LSP |
| Why it changed | `history` / `pr` / `ghHistoryResearch` |
| Metric/cycle/coverage number | external tool reference, then ask before running |

## 6. Output

For quick tasks: answer with the finding, evidence, and next step.

For non-trivial work: use `template_artifact_report.md` and include only relevant sections: summary, flows, data/contracts, boundaries, quality findings, execution risks, confidence, and next step.

For reviews: use `template_review_report.md`, cap findings to the few that matter, dedupe existing PR comments, and include concrete fixes.

## 7. Safety gates

Ask before continuing when a task would change a public contract, cross layers/packages, delete/rename shared things, affect many consumers, require an architectural tradeoff, or when evidence conflicts.
