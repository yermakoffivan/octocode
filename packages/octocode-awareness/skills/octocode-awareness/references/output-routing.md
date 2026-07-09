# Awareness Output Routing

Use this when choosing what an agent, script, or human should read next. Why: Awareness has live views, durable rows, and generated files; using the wrong layer creates stale context or needless projection churn.

Rule: use live output for current work, durable rows for cross-run state, and generated files only when context must be discoverable without querying SQLite.

## Live And Durable Outputs

| Output | Use when | Close or refresh |
|---|---|---|
| `attend` packet | Starting/resuming a task; need one compact orientation packet. | Follow its command-shaped `next`; re-attend after material state changes. |
| `workspace status` / `query workboard` | Inspecting locks, pending verify, inbox, ready work, or projection health. | Act on the row; resolve, verify, or mark its owning record done. |
| `query <view>` JSON/table/CSV/Markdown/HTML | JSON for agents/APIs; table for terminal; CSV for scripts; Markdown for review; HTML for humans. | Re-run for freshness; an export is a snapshot, not authority. |
| Memory row / recall | A verified lesson, decision, gotcha, or source lead should help a later run. | Re-verify before use; supersede or `memory forget --dry-run` when stale. |
| Task, lock, verification | Coordinating an edit and its declared check. | Release as `PENDING`, then `verify mark`; audit before success. |
| Signal thread | A blocker, question, request, decision, handoff, or FYI needs another participant. | Reply/ack after acting; resolve when no response or work remains. |
| Refinement / session capture | Work survives a run or needs an explicit owner/next action. | Apply and verify, then `refinement set --refinement-id <id> --state done`. |
| Reflection / weakness / harness output | A meaningful outcome, recurring failure, or harness gap should change future behavior. | Follow `references/learning-loop.md`; previews never self-apply. |
| `docs staleness` / digest / prune report | Reviewing likely drift or cleanup candidates. | Inspect evidence, approve mutations, run them, then query again. |
| `schema` / `docs list|show` | A command contract or focused skill procedure is unfamiliar. | Use the returned contract/reference; do not persist it as memory. |

## Generated Repo Outputs

| File | Use when |
|---|---|
| `.octocode/AGENTS.md` | Default-load map and Retro Files index for agents; root `AGENTS.md` points here. |
| `MEMORY.md` | Humans/agents need a bounded index of active durable memories. |
| `GOTCHAS.md` | Traps and failure signatures should be visible before work. |
| `LEARN.md` | Decisions, architecture, workflows, and opportunities need a readable digest. |
| `BOOKMARKS.md` | Source URLs, repos, files, papers, or skills should be discoverable as leads. |
| `DEVELOPER_REVIEW.md` | Instruction authors need open/resolved feedback from `--fix-instructions`. |
| `awareness/csv/*.csv` | Scripts or analysts need full sortable rows beyond Markdown budgets. |
| `awareness/index.html` | A human needs search, filters, and sortable cross-view inspection. |
| `awareness/manifest.json` | Checking generation time, scope, budgets, or local/share warnings. |
| `references/` | Compact generated notes are needed without expanding the main map. |

Generate with `repo inject` only after meaningful durable changes or when a requested snapshot is stale. For mechanics, budgets, sharing, and the root pointer, read `references/repo-context-management.md`.
