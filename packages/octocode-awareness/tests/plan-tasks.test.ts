import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, tableColumns } from '../src/db.js';
import { createPlan, getPlan, joinPlan, registerPlanDocument } from '../src/plans.js';
import {
  addTaskDependency,
  claimTask,
  createTask,
  listReadyTasks,
  releaseTaskClaim,
  submitTask,
} from '../src/tasks.js';
import { auditUnverified, markVerified } from '../src/verify.js';
import { preFlightIntent, releaseFileLock } from '../src/intents.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  initDb(db);
  return db;
}

describe('plan and task collaboration', () => {
  it('keeps durable tasks distinct from execution runs', () => {
    const db = freshDb();
    expect([...tableColumns(db, 'tasks')]).toEqual(expect.arrayContaining([
      'task_id', 'plan_id', 'title', 'reasoning', 'status',
    ]));
    expect([...tableColumns(db, 'task_runs')]).toEqual(expect.arrayContaining([
      'run_id', 'task_id', 'agent_id', 'test_plan', 'status',
    ]));
    expect(tableColumns(db, 'tasks').has('test_plan')).toBe(false);
    expect(tableColumns(db, 'task_runs').has('title')).toBe(false);
  });

  it('creates a managed plan document and registers the lead as a member', () => {
    const db = freshDb();
    const workspace = mkdtempSync(join(tmpdir(), 'oc-plan-'));
    try {
      const created = createPlan(db, {
        name: 'Awareness collaboration',
        objective: 'Let agents choose ready work from one shared plan.',
        leadAgentId: 'lead-agent',
        workspacePath: workspace,
      });

      expect(created.plan.plan_id).toMatch(/^plan_/);
      expect(created.plan.status).toBe('DRAFT');
      expect(created.plan.doc_dir).toMatch(/^\.octocode\/plan\/\d{8}-\d{6}Z-awareness-collaboration$/);
      expect(existsSync(join(workspace, created.plan.doc_dir, 'PLAN.md'))).toBe(true);
      expect(readFileSync(join(workspace, created.plan.doc_dir, 'PLAN.md'), 'utf8'))
        .toContain('task state are live in the Awareness database');
      expect(readFileSync(join(workspace, created.plan.doc_dir, 'PLAN.md'), 'utf8'))
        .not.toContain('Status:');

      joinPlan(db, { planId: created.plan.plan_id, agentId: 'worker-agent' });
      writeFileSync(join(workspace, created.plan.doc_dir, 'docs', 'DESIGN.md'), '# Design\n', 'utf8');
      registerPlanDocument(db, {
        planId: created.plan.plan_id,
        agentId: 'worker-agent',
        relativePath: 'docs/DESIGN.md',
        title: 'Design',
      });
      const plan = getPlan(db, created.plan.plan_id);
      expect(plan?.members.map((member) => member.agent_id).sort())
        .toEqual(['lead-agent', 'worker-agent']);
      expect(plan?.docs.map((doc) => doc.relative_path)).toEqual(['PLAN.md', 'docs/DESIGN.md']);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('requires reasoning and at least one path for every task', () => {
    const db = freshDb();
    const workspace = mkdtempSync(join(tmpdir(), 'oc-plan-'));
    try {
      const { plan } = createPlan(db, {
        name: 'Validation',
        objective: 'Keep task intent inspectable.',
        leadAgentId: 'lead',
        workspacePath: workspace,
      });
      expect(() => createTask(db, {
        planId: plan.plan_id,
        title: 'Missing reasoning',
        reasoning: ' ',
        paths: ['src/a.ts'],
        createdBy: 'lead',
      })).toThrow(/reasoning/i);
      expect(() => createTask(db, {
        planId: plan.plan_id,
        title: 'Missing paths',
        reasoning: 'This task has no ownership boundary.',
        paths: [],
        createdBy: 'lead',
      })).toThrow(/path/i);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('derives readiness from dependencies and atomically claims one task', () => {
    const db = freshDb();
    const workspace = mkdtempSync(join(tmpdir(), 'oc-plan-'));
    try {
      const { plan } = createPlan(db, {
        name: 'Dependency flow',
        objective: 'Only expose unblocked tasks.',
        leadAgentId: 'lead',
        workspacePath: workspace,
      });
      const first = createTask(db, {
        planId: plan.plan_id,
        title: 'Schema',
        reasoning: 'The storage contract must exist before consumers.',
        paths: ['src/db.ts'],
        createdBy: 'lead',
      });
      const second = createTask(db, {
        planId: plan.plan_id,
        title: 'CLI',
        reasoning: 'The CLI consumes the storage contract.',
        paths: ['bin/awareness.ts'],
        createdBy: 'lead',
      });
      addTaskDependency(db, {
        taskId: second.task.task_id,
        dependsOnTaskId: first.task.task_id,
        agentId: 'lead',
      });

      expect(listReadyTasks(db, { planId: plan.plan_id }).map((task) => task.task_id))
        .toEqual([first.task.task_id]);

      const claim = claimTask(db, { taskId: first.task.task_id, agentId: 'worker-a' });
      expect(claim.ok).toBe(true);
      if (!claim.ok) throw new Error(claim.error);
      expect(claim.run.run_id).toMatch(/^run_/);
      expect(claim.task.status).toBe('IN_PROGRESS');

      const competing = claimTask(db, { taskId: first.task.task_id, agentId: 'worker-b' });
      expect(competing.ok).toBe(false);
      if (!competing.ok) expect(competing.error).toMatch(/claimed/i);

      const submitted = submitTask(db, {
        taskId: first.task.task_id,
        runId: claim.run.run_id,
        agentId: 'worker-a',
        message: 'schema tests pass',
      });
      expect(submitted.task.status).toBe('VERIFY');

      const verified = markVerified(db, {
        runId: claim.run.run_id,
        agentId: 'worker-a',
        status: 'SUCCESS',
        message: 'targeted tests passed',
      });
      expect(verified.ok).toBe(true);
      expect(db.prepare('SELECT status FROM tasks WHERE task_id = ?')
        .get(first.task.task_id)).toEqual({ status: 'DONE' });
      expect(listReadyTasks(db, { planId: plan.plan_id }).map((task) => task.task_id))
        .toEqual([second.task.task_id]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('attaches repeated file edits to a claimed task run while quick locks stay standalone', () => {
    const db = freshDb();
    const workspace = mkdtempSync(join(tmpdir(), 'oc-plan-'));
    try {
      const { plan } = createPlan(db, {
        name: 'Hook grouping', objective: 'Keep one run per claimed task.',
        leadAgentId: 'lead', workspacePath: workspace,
      });
      const { task } = createTask(db, {
        planId: plan.plan_id, title: 'Edit two files', reasoning: 'Both edits implement one task.',
        paths: ['src/a.ts', 'src/b.ts'], createdBy: 'lead',
      });
      const claimed = claimTask(db, { taskId: task.task_id, agentId: 'worker' });
      if (!claimed.ok) throw new Error(claimed.error);

      for (const file of ['src/a.ts', 'src/b.ts']) {
        const lock = preFlightIntent(db, {
          runId: claimed.run.run_id,
          agentId: 'worker',
          workspacePath: workspace,
          targetFiles: [file],
        });
        expect(lock.ok).toBe(true);
        releaseFileLock(db, { runId: claimed.run.run_id, agentId: 'worker', status: 'ACTIVE' });
      }
      expect(db.prepare('SELECT COUNT(*) AS count FROM task_runs WHERE task_id = ?')
        .get(task.task_id)).toEqual({ count: 1 });
      expect(JSON.parse((db.prepare('SELECT files_json FROM task_runs WHERE run_id = ?')
        .get(claimed.run.run_id) as { files_json: string }).files_json)).toHaveLength(2);

      const standalone = preFlightIntent(db, {
        agentId: 'quick-worker', workspacePath: workspace, targetFiles: ['README.md'],
      });
      if (!standalone.ok) throw new Error('standalone lock failed');
      expect(standalone.run.task_id).toBeNull();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('does not treat a live task claim between edits as a stale standalone run', () => {
    const db = freshDb();
    const workspace = mkdtempSync(join(tmpdir(), 'oc-plan-'));
    try {
      const { plan } = createPlan(db, {
        name: 'Long task', objective: 'Let a task outlive each short file lock.',
        leadAgentId: 'lead', workspacePath: workspace,
      });
      const { task } = createTask(db, {
        planId: plan.plan_id, title: 'Several edits', reasoning: 'The agent pauses between files.',
        paths: ['src/a.ts'], createdBy: 'lead',
      });
      const claim = claimTask(db, { taskId: task.task_id, agentId: 'worker' });
      if (!claim.ok) throw new Error(claim.error);
      db.prepare('UPDATE task_runs SET files_json = ? WHERE run_id = ?')
        .run(JSON.stringify([join(workspace, 'src/a.ts')]), claim.run.run_id);

      const audit = auditUnverified(db, { agentId: 'worker', workspacePath: workspace });
      expect(audit.stale_active).toEqual([]);
      expect(db.prepare('SELECT status FROM tasks WHERE task_id = ?').get(task.task_id))
        .toEqual({ status: 'IN_PROGRESS' });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('clears exact-file locks when a task claim is released', () => {
    const db = freshDb();
    const workspace = mkdtempSync(join(tmpdir(), 'oc-plan-'));
    try {
      const { plan } = createPlan(db, {
        name: 'Release locks', objective: 'Return plan work without blocking the next agent.',
        leadAgentId: 'lead', workspacePath: workspace,
      });
      const { task } = createTask(db, {
        planId: plan.plan_id, title: 'Attempt work', reasoning: 'The first attempt may stop early.',
        paths: ['src/a.ts'], createdBy: 'lead',
      });
      const claim = claimTask(db, { taskId: task.task_id, agentId: 'worker' });
      if (!claim.ok) throw new Error(claim.error);
      const locked = preFlightIntent(db, {
        runId: claim.run.run_id, agentId: 'worker', workspacePath: workspace, targetFiles: ['src/a.ts'],
      });
      expect(locked.ok).toBe(true);

      const released = releaseTaskClaim(db, {
        taskId: task.task_id, runId: claim.run.run_id, agentId: 'worker',
      });
      expect(released.status).toBe('OPEN');
      expect(db.prepare('SELECT COUNT(*) AS count FROM locks WHERE run_id = ?')
        .get(claim.run.run_id)).toEqual({ count: 0 });
      expect(db.prepare('SELECT status FROM task_runs WHERE run_id = ?')
        .get(claim.run.run_id)).toEqual({ status: 'FAILED' });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('fails the durable task when its pending run is explicitly abandoned', () => {
    const db = freshDb();
    const workspace = mkdtempSync(join(tmpdir(), 'oc-plan-'));
    try {
      const { plan } = createPlan(db, {
        name: 'Abandon', objective: 'Keep task and run terminal states aligned.',
        leadAgentId: 'lead', workspacePath: workspace,
      });
      const { task } = createTask(db, {
        planId: plan.plan_id, title: 'Failed work', reasoning: 'The implementation cannot be verified.',
        paths: ['src/fail.ts'], createdBy: 'lead',
      });
      const claim = claimTask(db, { taskId: task.task_id, agentId: 'worker' });
      if (!claim.ok) throw new Error(claim.error);
      submitTask(db, { taskId: task.task_id, runId: claim.run.run_id, agentId: 'worker' });

      auditUnverified(db, { agentId: 'worker', workspacePath: workspace, abandon: true });
      expect(db.prepare('SELECT status FROM tasks WHERE task_id = ?').get(task.task_id))
        .toEqual({ status: 'FAILED' });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
