# Hook Runtime Semantics

Read this when hook identity, failure behavior, payload extraction, or host event differences matter. Installation and lifecycle selection live in `references/hooks.md`.

## Invariants

- Identity order: `OCTOCODE_AGENT_ID`, payload agent id, payload session id, then a warned host/workspace fallback. Pi falls back to session basename or pid.
- Export a stable id so hooks and manual commands share task claims, runs, locks, and signals.
- File locks expire after at most 10 minutes. Task claims use a separate lease/heartbeat. Neither TTL proves completion.
- Pre/post correlation uses small files under the Awareness home. Missing correlation fails open and leaves TTL/audit cleanup.
- Pre-edit blocks with exit `2` only for a genuine lock conflict. Infrastructure/input failures warn and fail open.
- With one live task claim, hooks attach edits to its run and release interim locks as `ACTIVE`; the agent later submits the task.
- Without a claim, hooks create a standalone run and release it as `PENDING` after edit. Stop hooks own the verification gate.
- Wrappers parse Claude tool paths, Cursor flat paths, Pi input/args paths, and Codex `apply_patch` payloads. Non-file calls no-op.
- Waits are bounded; use `lock wait` or `lock acquire --wait-seconds`, both capped at 3600 seconds.
- All hooks use the canonical SQLite DB. They never write workspace `.octocode/`; `repo inject` owns publication.

## Event Differences

| Edge | Claude/Codex | Cursor | Pi |
|---|---|---|---|
| Before write | `PreToolUse` | `preToolUse` | `tool_call` / execution start |
| After write | `PostToolUse` | `postToolUse` | `tool_result` / execution end |
| Briefing | `UserPromptSubmit` | `sessionStart` | `before_agent_start` |
| Verify | `Stop` / `SubagentStop` | `stop` / `subagentStop` | `agent_end` reminder |
| Capture | Claude `SessionEnd`; Codex `PreCompact` | `sessionEnd` / `preCompact` | shutdown / before compact |

Pi cannot hard-block after `agent_end`; it injects one reminder per unchanged pending-run set. Cursor cloud lacks several prompt/session/stop events, so treat local and cloud behavior separately.

## Tuning

- `OCTOCODE_NOTIFY_RUN_DIGEST=1` adds digest work to briefing; leave off for lightweight prompts.
- `OCTOCODE_NO_VERIFY_GATE=1` disables the stop gate; use only with an explicit replacement process.
- `OCTOCODE_ALLOW_HARNESS_APPLY=1` opens self-edit approval, but main/master remains blocked; detached/non-repo also needs `OCTOCODE_HARNESS_BRANCH_OK=1`.
- Narrow a matcher or remove Awareness-owned config to disable a hook. Rebuild after changing package-owned scripts or TTL behavior.

Keep pre-edit strict and fast, post-edit best-effort, and verification explicit.
