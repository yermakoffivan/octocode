# File Locks And Verification

File locks prevent overlapping agents from silently editing the same exact file. Locks belong to execution runs, not directly to durable plan tasks.

## Two Valid Flows

Quick edit—no plan or task required:

```text
lock acquire -> standalone task_run -> edit -> lock release PENDING -> verify mark
```

Collaborative task:

```text
task claim -> linked ACTIVE task_run -> lock/edit/release locks as needed
           -> task submit -> run PENDING + task VERIFY -> verify mark -> task DONE|FAILED
```

Task paths communicate a broad ownership boundary. File locks remain the exact collision authority.

## Run State

```text
ACTIVE -> PENDING -> SUCCESS
              \----> FAILED
```

Unverified `SUCCESS` is downgraded to `PENDING`. “I stopped editing” and “I ran the promised check” are separate facts.

## Standalone Acquire

```bash
octocode-awareness lock acquire \
  --agent-id "$OCTOCODE_AGENT_ID" \
  --workspace "$PWD" \
  --rationale "Edit awareness docs" \
  --test-plan "git diff --check && yarn workspace @octocodeai/octocode-awareness build" \
  --target-file packages/octocode-awareness/docs/DB.md \
  --compact
```

This atomically evicts expired locks, checks conflicts, creates a standalone `task_runs` row (`task_id = NULL`), and inserts one lock per target file under `BEGIN IMMEDIATE`.

At least one target is required. `EXCLUSIVE` conflicts with every other agent's live lock on that file; `SHARED` conflicts with `EXCLUSIVE`.

## Attach To A Claimed Task

`task claim` returns a `run_id`. Explicit callers can attach edits:

```bash
octocode-awareness lock acquire \
  --agent-id "$OCTOCODE_AGENT_ID" \
  --run-id run_abc \
  --target-file src/a.ts \
  --compact
```

Installed hooks do this automatically when the same agent has exactly one live task claim in the workspace. Post-edit releases the exact locks but keeps the linked run `ACTIVE`; `task submit` creates the verification obligation. If zero or multiple task claims match, hooks avoid guessing.

## Wait And Release

```bash
octocode-awareness lock wait \
  --agent-id "$OCTOCODE_AGENT_ID" \
  --target-file src/index.ts \
  --wait-seconds 120 --retry-interval 5 --compact
```

Wait checks only; it does not claim. Acquire immediately after a clear result.

```bash
octocode-awareness lock release \
  --agent-id "$OCTOCODE_AGENT_ID" \
  --run-id run_abc \
  --status PENDING \
  --compact
```

Target-file release is allowed, but overlapping runs from the same agent can make it ambiguous. Prefer `--run-id`.

Terminal `lock release` states apply only to standalone runs. A task-linked run accepts `--status ACTIVE` for interim file release; use `task submit` or `task release` for its lifecycle. The CLI rejects terminal lock release on linked runs.

For a verified standalone edit, release can close directly:

```bash
octocode-awareness lock release \
  --agent-id "$OCTOCODE_AGENT_ID" \
  --run-id run_abc \
  --status SUCCESS --verified \
  --verified-note "markdown checks passed" --compact
```

## Verify

```bash
octocode-awareness verify audit \
  --agent-id "$OCTOCODE_AGENT_ID" --workspace "$PWD" --compact

octocode-awareness verify mark \
  --agent-id "$OCTOCODE_AGENT_ID" --run-id run_abc \
  --message "focused tests passed" --compact
```

`verify mark` updates a pending run and writes `run_log`. If the run is linked to a task in `VERIFY`, it also writes `task_events` and moves that task to `DONE` or `FAILED`.

Scoped `--all-pending` closes this agent's pending runs in the workspace. Unscoped `--all-pending` spans all workspaces and emits a warning.

## TTL And Prune

File-lock TTL is hard-capped at 10 minutes. It recovers from crashes; it does not prove work ended.
If a standalone run's locks already expired, explicit `lock release --run-id ...` can still close that run after real verification.

```bash
octocode-awareness lock prune \
  --workspace "$PWD" --expired-only --dry-run --compact
```

Pruning removes locks and moves an orphaned `ACTIVE` run to `PENDING`; it never manufactures success. Task claim leases are separate (default 30 minutes, max 60) and use `task heartbeat`.

## Conflict Packet

Acquire conflict exits `2` and returns:

```json
{
  "file_path": "/repo/src/auth.ts",
  "lock_type": "EXCLUSIVE",
  "agent_id": "agent-a",
  "reasoning": "refactoring auth token flow",
  "test_plan": "yarn test auth",
  "run_id": "run_...",
  "session_id": "sess-...",
  "holder_session_active": true,
  "acquired_at": "...",
  "expires_at": "..."
}
```

Read the holder's reason, then wait, signal the holder with the `run_id`, switch to another ready task/file, or prune only after expiry. Do not bypass a live lock.

## Hook Effects

| Hook | Standalone flow | Claimed-task flow |
|---|---|---|
| pre-edit | Creates run + locks | Reuses claimed run + adds locks |
| post-edit | Removes locks; run becomes `PENDING` | Removes locks; run stays `ACTIVE` |
| stop-verify | Blocks on pending/stale runs | Blocks after task submission until verify |
| session-end | Captures active/pending runs and dirty files | Same, retaining linked task/run ids |
