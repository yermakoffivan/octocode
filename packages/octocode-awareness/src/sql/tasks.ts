// src/sql/tasks.ts — SQL constants for the tasks and task_log tables.
//
// Only the verify gate (src/verify.ts) consumes shared task SQL constants; the
// lock/claim path (src/intents.ts), lock eviction (src/db.ts), workspace/status
// listing (src/maintenance.ts) and session capture write their queries inline.
// This file therefore holds exactly the constants verify.ts imports — nothing
// more — so there is a single source of truth per query and no dormant, silently
// drifting copies. Do NOT re-add "canonical" lock/task constants here unless a
// caller actually imports them.

// ─── Task selects ─────────────────────────────────────────────────────────────

/**
 * Select task_id list of PENDING tasks for markVerified allPending.
 * {DYNAMIC_WHERE}: mandatory "agent_id = ?" plus optional workspace_path filter.
 * bind: (agentId, ...optional_scope_values)
 */
export const TASKS_SELECT_PENDING_IDS =
  `SELECT task_id FROM tasks WHERE status = 'PENDING' AND agent_id = ? {DYNAMIC_WHERE}`;

/**
 * Fetch agent_id and status for a single task (used to distinguish error cases in markVerified).
 * bind: (task_id)
 */
export const TASKS_SELECT_STATUS =
  `SELECT agent_id, status FROM tasks WHERE task_id = ?`;

// ─── Task updates ─────────────────────────────────────────────────────────────

/** Transition only a PENDING task to a new status; bind: (status, updated_at, task_id) */
export const TASKS_UPDATE_PENDING_VERIFIED =
  `UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ? AND status = 'PENDING'`;

/** Transition only a PENDING task to a new status, scoped to agent; bind: (status, updated_at, task_id, agent_id) */
export const TASKS_UPDATE_PENDING_VERIFIED_BY_AGENT =
  `UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ? AND agent_id = ? AND status = 'PENDING'`;

/** Abandon a PENDING task as FAILED (audit --abandon); bind: (updated_at, task_id) */
export const TASKS_UPDATE_PENDING_TO_FAILED =
  `UPDATE tasks SET status = 'FAILED', updated_at = ? WHERE task_id = ? AND status = 'PENDING'`;

/** Mark a stale ACTIVE task as FAILED (abandon stale-active); bind: (updated_at, task_id) */
export const TASKS_UPDATE_ACTIVE_TO_FAILED =
  `UPDATE tasks SET status = 'FAILED', updated_at = ? WHERE task_id = ? AND status = 'ACTIVE'`;

// ─── task_log inserts ─────────────────────────────────────────────────────────

/** Record a VERIFIED event after an agent confirms its edits; bind: (event_id, task_id, agent_id, message, created_at) */
export const TASK_LOG_INSERT_VERIFIED =
  `INSERT INTO task_log(event_id, task_id, agent_id, event_type, message, created_at)
   VALUES (?, ?, ?, 'VERIFIED', ?, ?)`;

/** Record an ABANDONED event when audit --abandon dismisses an orphaned PENDING task; bind: (event_id, task_id, agent_id, created_at) */
export const TASK_LOG_INSERT_ABANDONED =
  `INSERT INTO task_log(event_id, task_id, agent_id, event_type, message, created_at)
   VALUES (?, ?, ?, 'ABANDONED', 'orphaned by audit-unverified --abandon', ?)`;

/** Record an ABANDONED event when audit --abandon clears a stale ACTIVE (no-live-locks) task; bind: (event_id, task_id, agent_id, created_at) */
export const TASK_LOG_INSERT_STALE_ABANDONED =
  `INSERT INTO task_log(event_id, task_id, agent_id, event_type, message, created_at)
   VALUES (?, ?, ?, 'ABANDONED', 'stale active (no live locks) abandoned by audit-unverified --abandon', ?)`;
