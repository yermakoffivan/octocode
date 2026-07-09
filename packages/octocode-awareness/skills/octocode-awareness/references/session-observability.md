# Session Observability

Read this when timing, stale references, workspace views, or an end-of-session handoff matters. Collision decisions live in `references/files-awareness.md`.

## Time And Views

Compare lock `acquired_at`/`expires_at`, row `created_at`/`updated_at`, and file mtimes. A recent memory timestamp does not prove the file is current.

| Output | Use when |
|---|---|
| `workspace status` | Plan/task counts, live locks, and pending runs need a quick check. |
| `query workboard` | Inbox, verify debt, ready work, memory review, and projection health need prioritization. |
| `query files` | Stored paths/references may be missing or stale. |
| `query memories --format markdown` | A readable memory snapshot is needed. |
| `query all --format html` | A human needs search/filter/sort across views. |
| `reflect mine-weakness` | Recurring failure signatures need ranking. |
| `maintenance digest --dry-run` | Cleanup impact must be previewed. |

Live query output beats exported files for freshness. See `references/output-routing.md` for format and projection selection.

## Session Capture

Use `session capture` when unresolved work must survive session end or compaction. It writes a `quality=handoff` refinement from this session's locks plus the dirty Git tree.

Capture no-ops on a clean tree with no session locks, skips a clear/reset reason, and can be disabled with `OCTOCODE_NO_SESSION_CAPTURE=1`. Read captured rows with `refinement get --include-handoffs`.

Claude uses `SessionEnd`; Codex uses best-effort `PreCompact`; Cursor uses local `sessionEnd` plus `preCompact`; Pi uses shutdown/before-compact events. Hooks are fail-open, so manually capture before a risky handoff when host support is uncertain.

Close the handoff by applying and verifying its action, then update the same refinement to `done`.
