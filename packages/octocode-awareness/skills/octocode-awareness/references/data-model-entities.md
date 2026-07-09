# Awareness Data Model — Entities

Catalog and scope rules: `data-model.md`.

## Plans And Tasks

`plans` stores name, objective, lead, workspace, status (`DRAFT|ACTIVE|PAUSED|COMPLETED|CANCELLED`), and `doc_dir`. `plan_members` records participants. `plan_docs` registers `PLAN.md` plus supporting files inside the managed plan directory.

`tasks` stores durable work: plan, title, reasoning, acceptance criteria, priority, creator, status, and timestamps. Status is `OPEN|IN_PROGRESS|BLOCKED|VERIFY|DONE|FAILED|CANCELLED`.
`task_paths` records intended ownership. `task_dependencies` forms an acyclic graph inside one plan. `task_claims` is the leased single-owner claim; `task_events` is the history.

## Runs And Locks

`task_runs` stores one execution attempt: nullable `task_id`, agent/session, rationale, test plan, context ref, actual edited files, scope, and status (`ACTIVE|PENDING|SUCCESS|FAILED`). `task_id = NULL` means standalone quick work.

`locks` records each exact file under `run_id`, agent/session, type, and TTL. Locks disappear on release; `run_log` retains verification/abandon evidence. `edit_log` and `harness_log` also reference `run_id`.

```text
task: OPEN -> IN_PROGRESS -> VERIFY -> DONE|FAILED
                    \-> OPEN|BLOCKED (release)
run:  ACTIVE -> PENDING -> SUCCESS|FAILED
```

## Other Awareness State

`memories` holds durable lessons with scope, provenance in `memory_refs`, FTS, salience, validity, and supersession. `signals` plus `signal_reads` form the mailbox. `refinements` is durable follow-up, not a duplicate task queue. `sessions` groups work periods; `agents` records presence and scope.
