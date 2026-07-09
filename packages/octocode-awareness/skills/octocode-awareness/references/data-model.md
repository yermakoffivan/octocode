# Awareness Data Model

Use this for SQLite schema and scope. Inspect public contracts with `schema json-schema <name>`; maintainers inspect `src/db.ts` and `src/sql/*.ts`.

The canonical DB is `~/.octocode/memory/awareness.sqlite3` (or `$OCTOCODE_MEMORY_HOME/awareness.sqlite3`). `<repo>/.octocode/` contains generated projections plus authored `.octocode/plan/` documents; it is not the DB.

## Collaboration Core

```text
plan -> durable tasks -> one claim/run at a time -> exact-file locks
                    \-> dependencies/events
quick work ---------> standalone run -----------> exact-file locks
```

- A `plan` has one lead agent, members, objective, lifecycle, and registered documents.
- A `task` belongs to one plan and stores title, reasoning, acceptance, paths, dependencies, priority, and durable status.
- A `task_run` is execution evidence. Its nullable `task_id` distinguishes plan work from a standalone quick lock.
- A `lock` belongs to a run. Verification closes the run and, when linked, the durable task.

Readiness is derived: an OPEN task is ready only when it is unclaimed and every dependency is DONE. There is no READY row status and no separate “today's tasks” table.

## Main Tables

| Family | Tables |
|---|---|
| Collaboration | `plans`, `plan_members`, `plan_docs`, `tasks`, `task_paths`, `task_dependencies`, `task_claims`, `task_events` |
| Execution | `task_runs`, `locks`, `run_log`, `edit_log`, `harness_log` |
| Awareness | `agents`, `sessions`, `memories`, `memory_refs`, `signals`, `signal_reads`, `refinements` |

Scope is primarily `workspace_path`, then optional `artifact`, `repo`, and `ref`. Explicit IDs (`plan_id`, `task_id`, `run_id`, and others) are stable handles. Details: `data-model-entities.md`; joins: `data-model-relationships.md`.
