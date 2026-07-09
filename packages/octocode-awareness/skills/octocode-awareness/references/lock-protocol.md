# Lock And Verification Protocol

Read `plan-task-workflow.md` first to choose shared task or quick work. Collision rules live in `files-awareness.md`.

## Acquire

Run `lock acquire` before edits with a stable agent, exact files, rationale, test plan, and workspace.
Pass a claimed task's `run_id` so repeated edits stay together. For quick work, omit the run; Awareness creates a standalone run (`task_id = NULL`).

Default locks are EXCLUSIVE. SHARED is for non-writing reads. Paths normalize to absolute, symlink-resolved paths. TTL is crash safety, not completion.

- Exit 0: acquired; edit may proceed.
- Exit 2: conflict; wait, coordinate, or choose other work.
- Other non-zero: fix the usage/runtime error.

`lock wait` checks without claiming. It sleeps outside transactions. `lock prune --dry-run --expired-only` is the safest abandoned-holder cleanup.

## Release And Verify

Standalone run:

1. `lock release --run-id ... --status PENDING`
2. run the declared check
3. `verify mark --run-id ... --message ...`

For a claimed task, release interim locks with `--status ACTIVE` and use `task submit --task-id ... --run-id ...` when work ends. After the declared check, `verify mark --run-id ...` moves the task from VERIFY to DONE or FAILED.

`SUCCESS` without `--verified` downgrades to PENDING. `verify audit` is the final gate. Scoped `--all-pending` closes this agent's pending runs; avoid unscoped batch verification. `verify audit --abandon` fails both linked task and run, so use it only when truly abandoning work.
