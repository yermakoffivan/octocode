# Plan, Task, And Quick-Lock Workflow

Use this after `attend`. There is one work queue: durable `tasks` under a `plan`. Do not create a second “today's tasks” list in Markdown, memory, or refinements.

## Choose

1. Inspect workboard Ready/Claimed/Verify and `task ready|list`.
2. If a ready task matches the requested work, claim it. A claim is atomic and returns one execution `run_id`.
3. For a quick independent edit outside plan work, acquire a lock with task and run fields unset. Awareness creates a standalone run.
4. If coordinated work has no plan/task yet, ask the plan lead to create it or create it when authorized.

## Shared Plan Work

```bash
<cli> task claim --task-id task_123 --agent-id "$OCTOCODE_AGENT_ID"
<cli> lock acquire --run-id run_123 --agent-id "$OCTOCODE_AGENT_ID" --target-file src/a.ts
# edit; repeat locks with the same run_id
<cli> task submit --task-id task_123 --run-id run_123 --agent-id "$OCTOCODE_AGENT_ID" --message "tests passed"
<cli> verify mark --run-id run_123 --agent-id "$OCTOCODE_AGENT_ID" --message "declared test plan passed"
```

Heartbeat long claims. `task release` returns unfinished work to OPEN or BLOCKED. Dependencies determine readiness; agents do not manually maintain a READY status.

## Quick Independent Work

```bash
<cli> lock acquire --agent-id "$OCTOCODE_AGENT_ID" --target-file README.md --rationale "small docs fix" --test-plan "review diff"
# edit
<cli> lock release --run-id run_123 --agent-id "$OCTOCODE_AGENT_ID" --status PENDING
<cli> verify mark --run-id run_123 --agent-id "$OCTOCODE_AGENT_ID" --message "diff reviewed"
```

The DB is canonical for plan/task state. Plan documents live under `.octocode/plan/<timestamp>-<name>/`; `PLAN.md` explains objective and ownership, supporting docs live under `docs/`, and neither duplicates the live task list.
