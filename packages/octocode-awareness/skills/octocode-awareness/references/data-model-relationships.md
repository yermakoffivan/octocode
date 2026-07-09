# Awareness Data Model — Relationships & Queries

Catalog: `data-model.md`. Entity lifecycles: `data-model-entities.md`.

```text
plans -> plan_members
      -> plan_docs
      -> tasks -> task_paths
               -> task_dependencies -> tasks
               -> task_claims -> task_runs
               -> task_events
task_runs -> locks
          -> run_log
          -> edit_log / harness_log
agents -> sessions / memories / plans / claims / runs / signals
```

```sql
-- Ready tasks: OPEN, unclaimed, all dependencies DONE.
SELECT t.task_id, t.title, t.priority
FROM tasks t
WHERE t.status = 'OPEN'
  AND NOT EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id = t.task_id)
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies d
    JOIN tasks dependency ON dependency.task_id = d.depends_on_task_id
    WHERE d.task_id = t.task_id AND dependency.status <> 'DONE'
  );

-- Active locks with both durable task and execution identity.
SELECT l.file_path, l.lock_type, r.run_id, r.task_id, r.agent_id, l.expires_at
FROM locks l JOIN task_runs r ON r.run_id = l.run_id
WHERE r.workspace_path = ?;

-- Verification debt is execution state; task completion follows it.
SELECT run_id, task_id, test_plan, files_json
FROM task_runs
WHERE agent_id = ? AND status = 'PENDING';
```
